/**
 * WhisperService — port từ apps/web/src/lib/media/whisper.ts. Web dùng openai
 * SDK (baseURL Groq); api KHÔNG có dep openai → gọi REST fetch multipart
 * thẳng endpoint OpenAI-compatible, GIỮ model/params y cũ:
 *   - Groq (GROQ_API_KEY, free): whisper-large-v3-turbo
 *   - OpenAI (OPENAI_API_KEY, paid): whisper-1
 *   - response_format verbose_json để có segments timestamps (chapter detection)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';

export type TranscribeSegment = {
  /** Giây bắt đầu của segment trong audio. */
  start: number;
  /** Giây kết thúc. */
  end: number;
  /** Text của segment. */
  text: string;
};

export type TranscribeResult = {
  /** Full transcript (đã join các segment). */
  text: string;
  /** Mỗi segment ~5-30s — timestamp lookup + chapter detection. */
  segments: TranscribeSegment[];
  /** Ngôn ngữ detect được (vi, en, ...). */
  language: string;
  /** Duration audio (giây). */
  duration: number;
};

export type TranscribeOptions = {
  /** ISO code, default 'vi'. 'auto' = bỏ trống cho model tự detect. */
  language?: 'vi' | 'en' | 'auto';
  /** Override model. */
  model?: string;
};

@Injectable()
export class WhisperService {
  /** Provider available? — pipeline skip transcribe thay vì throw. */
  isConfigured(): boolean {
    return !!process.env.GROQ_API_KEY || !!process.env.OPENAI_API_KEY;
  }

  /**
   * Transcribe 1 file audio/video (max 25MB theo provider).
   * Ưu tiên Groq (free, nhanh 5-10x) trước OpenAI — y getClient() lib cũ.
   */
  async transcribe(audioPath: string, opts: TranscribeOptions = {}): Promise<TranscribeResult> {
    const { url, apiKey, defaultModel } = this.pickProvider();
    const language = opts.language === 'auto' ? undefined : (opts.language ?? 'vi');

    const fileBuf = await fs.readFile(audioPath);
    const form = new FormData();
    // new Uint8Array(buf) copy sang ArrayBuffer thuần — Blob không nhận
    // Buffer<ArrayBufferLike> trực tiếp với @types/node mới.
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
        // whisper-large-v3-turbo: nhanh hơn, đủ chính xác cho hầu hết use case
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
