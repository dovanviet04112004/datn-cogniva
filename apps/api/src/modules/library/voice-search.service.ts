/**
 * VoiceSearchService — port từ apps/web/src/app/api/library/voice-search/route.ts
 * (Phase 5): audio → Whisper transcribe → crossDocSearch top 5.
 *
 * Whisper: web dùng SDK openai (baseURL Groq); api gọi REST multipart thẳng
 * theo pattern modules/rooms/media/whisper.service.ts (service đó không export
 * khỏi RoomsPipelineModule + nhận file path thay vì buffer → copy local).
 * Provider/model GIỮ NGUYÊN: Groq whisper-large-v3-turbo trước, OpenAI
 * whisper-1 fallback, thiếu key → Error('Whisper chưa cấu hình').
 *
 * Rate limit: 30 req/giờ/user qua notification_log (rate-limit-by-DB tạm của
 * Phase 5 — GIỮ NGUYÊN, không chuyển Redis để không lệch hành vi).
 */
import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma.service';
import { CrossDocSearchService, type CrossDocChunkHit } from './cross-doc-search.service';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // OpenAI/Groq limit
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
    // Rate limit (route cũ check TRƯỚC khi parse multipart; multer parse trước
    // handler — chỉ lệch khi cả 2 cùng fail, chấp nhận).
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

    // Route cũ: request.formData() throw khi body không phải multipart → 400
    // với message undici; multer skip silent → tự check content-type.
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

    // Optional filters JSON — invalid thì skip (y route cũ)
    let filters: Record<string, unknown> = {};
    if (typeof body.filters === 'string' && body.filters) {
      try {
        filters = JSON.parse(body.filters);
      } catch {
        // ignore invalid filters JSON — chỉ skip
      }
    }

    // Transcribe
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
      throw new HttpException(
        { error: 'Transcript trống — vui lòng nói rõ hơn', transcript },
        422,
      );
    }

    // Record usage (rate limit ledger) — fire-and-forget
    void this.recordVoiceUsage(userId, transcript.length);

    // RAG search
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

  /**
   * Rate limit qua notification_log audit table (tận dụng index sẵn có):
   * count rows type='library-voice-search-quota' trong 1h.
   */
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

  /** Best-effort — không throw vì user đã consume quota qua Whisper. */
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

  /** REST multipart Whisper từ buffer — provider pick y getWhisperClient cũ. */
  private async transcribe(
    audio: Express.Multer.File,
    language: 'vi' | 'en' | 'auto',
  ): Promise<{ transcript: string; language: string | undefined }> {
    const { url, apiKey, model } = pickWhisperProvider();

    const form = new FormData();
    // new Uint8Array(buf) copy sang ArrayBuffer thuần — Blob không nhận
    // Buffer<ArrayBufferLike> trực tiếp với @types/node mới.
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
