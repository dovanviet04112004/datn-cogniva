import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infra/database/prisma.service';
import { CrossDocSearchService, type CrossDocChunkHit } from './cross-doc-search.service';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const RATE_LIMIT_PER_HOUR = 30;

@Injectable()
export class VoiceSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crossDoc: CrossDocSearchService,
  ) {}

  async voiceSearch(
    userId: string,
    audio: Express.Multer.File | undefined,
    body: Record<string, unknown>,
    contentType: string,
  ) {
    const rl = await this.checkVoiceRateLimit(userId);
    if (!rl.allowed) {
      throw new HttpException(
        {
          error: `Đã đạt giới hạn ${rl.limit} voice search / giờ`,
          used: rl.used,
          limit: rl.limit,
        },
        429,
      );
    }

    if (!contentType.includes('multipart/form-data')) {
      throw new HttpException(
        { error: 'Invalid multipart: Could not parse content as FormData.' },
        400,
      );
    }
    if (!audio) {
      throw new HttpException({ error: 'Missing field `audio` (File)' }, 400);
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      throw new HttpException(
        { error: `Audio quá lớn (${audio.size} bytes > ${MAX_AUDIO_BYTES})` },
        413,
      );
    }
    const language = (typeof body.language === 'string' ? body.language : 'vi') as
      | 'vi'
      | 'en'
      | 'auto';

    let filters: Record<string, unknown> = {};
    if (typeof body.filters === 'string' && body.filters) {
      try {
        filters = JSON.parse(body.filters);
      } catch {}
    }

    let transcript: string;
    let detectedLanguage: string;
    try {
      const result = await this.transcribe(audio, language);
      transcript = result.transcript;
      detectedLanguage = result.language ?? language;
    } catch (err) {
      throw new HttpException({ error: `Whisper fail: ${(err as Error).message}` }, 502);
    }

    if (transcript.length < 2) {
      throw new HttpException({ error: 'Transcript trống — vui lòng nói rõ hơn', transcript }, 422);
    }

    void this.recordVoiceUsage(userId, transcript.length);

    let hits: CrossDocChunkHit[] = [];
    try {
      hits = await this.crossDoc.crossDocSearch({
        query: transcript,
        filters: filters as Parameters<CrossDocSearchService['crossDocSearch']>[0]['filters'],
        limit: 5,
      });
    } catch (err) {
      return {
        transcript,
        language: detectedLanguage,
        hits: [],
        searchError: (err as Error).message,
      };
    }

    return {
      transcript,
      language: detectedLanguage,
      hits,
      quota: { used: rl.used + 1, limit: rl.limit },
    };
  }

  private async checkVoiceRateLimit(
    userId: string,
  ): Promise<{ allowed: boolean; used: number; limit: number }> {
    const cutoff = new Date(Date.now() - 3600_000);
    const used = await this.prisma.notification_log.count({
      where: {
        user_id: userId,
        type: 'library-voice-search-quota',
        created_at: { gte: cutoff },
      },
    });
    return { allowed: used < RATE_LIMIT_PER_HOUR, used, limit: RATE_LIMIT_PER_HOUR };
  }

  private async recordVoiceUsage(userId: string, transcriptLen: number) {
    await this.prisma.notification_log
      .create({
        data: {
          id: randomUUID(),
          user_id: userId,
          type: 'library-voice-search-quota',
          title: 'Voice search',
          body: `Transcript ${transcriptLen} chars`,
          status: 'sent',
          sent_at: new Date(),
        },
      })
      .catch((err: unknown) => {
        console.error('[voice-search.record-usage]', err);
      });
  }

  private async transcribe(
    audio: Express.Multer.File,
    language: 'vi' | 'en' | 'auto',
  ): Promise<{ transcript: string; language: string | undefined }> {
    const { url, apiKey, model } = pickWhisperProvider();

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(audio.buffer)], { type: audio.mimetype }),
      audio.originalname || 'audio',
    );
    form.append('model', model);
    if (language !== 'auto') form.append('language', language);
    form.append('response_format', 'verbose_json');

    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const raw = (await res.json()) as { text?: string; language?: string };
    return { transcript: (raw.text ?? '').trim(), language: raw.language };
  }
}

function pickWhisperProvider(): { url: string; apiKey: string; model: string } {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return {
      url: 'https://api.groq.com/openai/v1/audio/transcriptions',
      apiKey: groqKey,
      model: 'whisper-large-v3-turbo',
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      url: 'https://api.openai.com/v1/audio/transcriptions',
      apiKey: openaiKey,
      model: 'whisper-1',
    };
  }
  throw new Error('Whisper chưa cấu hình');
}
