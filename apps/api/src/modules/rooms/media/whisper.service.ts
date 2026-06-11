import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';

export type TranscribeSegment = {
  start: number;
  end: number;
  text: string;
};

export type TranscribeResult = {
  text: string;
  segments: TranscribeSegment[];
  language: string;
  duration: number;
};

export type TranscribeOptions = {
  language?: 'vi' | 'en' | 'auto';
  model?: string;
};

@Injectable()
export class WhisperService {
  isConfigured(): boolean {
    return !!process.env.GROQ_API_KEY || !!process.env.OPENAI_API_KEY;
  }

  async transcribe(audioPath: string, opts: TranscribeOptions = {}): Promise<TranscribeResult> {
    const { url, apiKey, defaultModel } = this.pickProvider();
    const language = opts.language === 'auto' ? undefined : (opts.language ?? 'vi');

    const fileBuf = await fs.readFile(audioPath);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(fileBuf)]), path.basename(audioPath));
    form.append('model', opts.model ?? defaultModel);
    if (language) form.append('language', language);
    form.append('response_format', 'verbose_json');

    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`[whisper] transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const raw = (await res.json()) as {
      text: string;
      language?: string;
      duration?: number;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    return {
      text: raw.text,
      language: raw.language ?? 'vi',
      duration: raw.duration ?? 0,
      segments: (raw.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text.trim(),
      })),
    };
  }

  private pickProvider(): { url: string; apiKey: string; defaultModel: string } {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      return {
        url: 'https://api.groq.com/openai/v1/audio/transcriptions',
        apiKey: groqKey,
        defaultModel: 'whisper-large-v3-turbo',
      };
    }
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      return {
        url: 'https://api.openai.com/v1/audio/transcriptions',
        apiKey: openaiKey,
        defaultModel: 'whisper-1',
      };
    }
    throw new Error(
      'Whisper chưa cấu hình — set GROQ_API_KEY (free) hoặc OPENAI_API_KEY (paid) trong apps/web/.env.local.',
    );
  }
}
