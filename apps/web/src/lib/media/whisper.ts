/**
 * Whisper transcribe wrapper — auto-detect provider theo env.
 *
 * Priority:
 *   1. Groq (`GROQ_API_KEY`) — FREE tier, host whisper-large-v3-turbo, nhanh
 *      5-10x OpenAI, rate limit 25 req/phút. Endpoint OpenAI-compatible.
 *   2. OpenAI (`OPENAI_API_KEY`) — paid $0.006/phút, stable.
 *
 * Format response `verbose_json` để có timestamps per segment cho chapter
 * detection (chapters.ts chia chương theo timestamp).
 */
import { createReadStream } from 'node:fs';
import OpenAI from 'openai';

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
  /** Mỗi segment ~5-30s — dùng cho timestamp lookup + chapter detection. */
  segments: TranscribeSegment[];
  /** Ngôn ngữ detect được (vi, en, ...). */
  language: string;
  /** Duration audio (giây). */
  duration: number;
};

export type TranscribeOptions = {
  /** ISO code, default 'vi' (Cogniva user chính là VN). 'auto' = bỏ trống. */
  language?: 'vi' | 'en' | 'auto';
  /** Override model — Phase 15 default whisper-1, V2 có thể dùng 'whisper-large-v3'. */
  model?: string;
};

/**
 * Singleton client — lazy init. Ưu tiên Groq (free) trước OpenAI (paid).
 * Trả về kèm `provider` để biết dùng model nào (Groq dùng whisper-large-v3,
 * OpenAI dùng whisper-1).
 */
let _client: { openai: OpenAI; provider: 'groq' | 'openai'; defaultModel: string } | null = null;
function getClient(): { openai: OpenAI; provider: 'groq' | 'openai'; defaultModel: string } {
  if (_client) return _client;
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    _client = {
      openai: new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' }),
      provider: 'groq',
      // whisper-large-v3-turbo: nhanh hơn, đủ chính xác cho hầu hết use case
      defaultModel: 'whisper-large-v3-turbo',
    };
    return _client;
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    _client = {
      openai: new OpenAI({ apiKey: openaiKey }),
      provider: 'openai',
      defaultModel: 'whisper-1',
    };
    return _client;
  }
  throw new Error(
    'Whisper chưa cấu hình — set GROQ_API_KEY (free) hoặc OPENAI_API_KEY (paid) trong apps/web/.env.local.',
  );
}

/**
 * Transcribe 1 file audio.
 *
 * @param audioPath - Đường dẫn local file (WAV/MP3/M4A, max 25MB theo OpenAI).
 *                    File dài > 25MB cần chunk trước (Phase 18 sẽ thêm).
 * @returns TranscribeResult với segments + timestamps
 */
export async function whisperTranscribe(
  audioPath: string,
  opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const { openai, defaultModel } = getClient();
  const language = opts.language === 'auto' ? undefined : (opts.language ?? 'vi');

  const result = await openai.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: opts.model ?? defaultModel,
    language,
    response_format: 'verbose_json',
    // timestamp_granularities: ['segment'] là default cho verbose_json
  });

  // OpenAI SDK type cho verbose_json không expose segments — cast manual
  const raw = result as unknown as {
    text: string;
    language: string;
    duration: number;
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

/**
 * Check xem Whisper provider có available không — pipeline có thể skip
 * transcribe step thay vì throw (file vẫn upload R2, replay xem được, không
 * có transcript).
 */
export function isWhisperConfigured(): boolean {
  return !!process.env.GROQ_API_KEY || !!process.env.OPENAI_API_KEY;
}
