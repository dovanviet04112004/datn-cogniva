/**
 * Whisper transcribe wrapper — gọi OpenAI Whisper API hoặc no-op fallback.
 *
 * Phase 15 v1 dùng OpenAI Whisper-1 vì:
 *   - Ổn định, free $5 credit khi signup mới, sau đó $0.006/phút
 *   - Latency 30-60s cho 1h audio (chạy trong Inngest step, OK)
 *   - Hỗ trợ tiếng Việt + 99 ngôn ngữ khác native
 *
 * V2 (phase 18+) sẽ tự host whisper.cpp khi cost > $50/tháng — interface giữ
 * nguyên `transcribe(audioPath, opts)` để swap không đụng pipeline.
 *
 * Format response `verbose_json` thay vì plain text vì cần timestamps per
 * segment để chapter detection (chapters.ts) phân biệt được "đoạn nào nói lúc
 * nào" — pipeline chia chương theo timestamp.
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

/** Singleton OpenAI client — lazy init để dev không có key không crash route. */
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY chưa cấu hình — Whisper transcribe cần key. ' +
        'Set trong apps/web/.env.local hoặc Vercel env.',
    );
  }
  _openai = new OpenAI({ apiKey });
  return _openai;
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
  const openai = getOpenAI();
  const language = opts.language === 'auto' ? undefined : (opts.language ?? 'vi');

  const result = await openai.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: opts.model ?? 'whisper-1',
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
 * Check xem Whisper key có available không — pipeline có thể skip transcribe
 * step thay vì throw (file vẫn upload R2, replay xem được, không có transcript).
 */
export function isWhisperConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
