/**
 * POST /api/library/voice-search — Phase 5 (2026-05-27).
 *
 * Mobile/web voice Q&A pipeline:
 *   1. Accept multipart/form-data với field `audio` (Blob, max 25MB)
 *   2. Transcribe qua Groq/OpenAI Whisper (verbose_json)
 *   3. Pass transcript text → crossDocSearch → top 5 chunk hits
 *   4. Return { transcript, language, hits } để client render
 *
 * Client tự gọi TTS nếu cần (Web Speech API ở web, AVSpeechSynthesizer iOS).
 * Phase 6 sẽ thêm LLM answer summary (Groq Llama 3.3 70B).
 *
 * Rate limit: 30 requests/giờ/user (Whisper Groq free tier ~25 req/phút global).
 * Phase 5 chấp nhận rate-limit-by-DB pattern đơn giản, V2 sẽ chuyển Redis.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import OpenAI from 'openai';

import { db, notificationLog } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { crossDocSearch } from '@/lib/library/cross-doc-search';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // OpenAI/Groq limit
const RATE_LIMIT_PER_HOUR = 30;

function getWhisperClient(): { client: OpenAI; model: string } {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return {
      client: new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' }),
      model: 'whisper-large-v3-turbo',
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      client: new OpenAI({ apiKey: openaiKey }),
      model: 'whisper-1',
    };
  }
  throw new Error('Whisper chưa cấu hình');
}

/**
 * Rate limit qua notification_log audit table tạm thời (tận dụng index sẵn có).
 * Insert 1 row type='library-voice-search-quota' mỗi call → count trong 1h.
 * Phase 6 sẽ thay bằng Redis sliding window.
 */
async function checkVoiceRateLimit(userId: string): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
}> {
  const cutoff = new Date(Date.now() - 3600_000);
  const [row] = await db
    .select({ used: sql<number>`COUNT(*)::int` })
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.userId, userId),
        eq(notificationLog.type, 'library-voice-search-quota'),
        gte(notificationLog.createdAt, cutoff),
      ),
    );
  const used = row?.used ?? 0;
  return {
    allowed: used < RATE_LIMIT_PER_HOUR,
    used,
    limit: RATE_LIMIT_PER_HOUR,
  };
}

async function recordVoiceUsage(userId: string, transcriptLen: number) {
  // Best-effort — không throw vì user đã consume quota qua Whisper
  await db
    .insert(notificationLog)
    .values({
      userId,
      type: 'library-voice-search-quota',
      title: 'Voice search',
      body: `Transcript ${transcriptLen} chars`,
      status: 'sent',
      sentAt: new Date(),
    })
    .catch((err) => {
      console.error('[voice-search.record-usage]', err);
    });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit
  const rl = await checkVoiceRateLimit(session.user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Đã đạt giới hạn ${rl.limit} voice search / giờ`,
        used: rl.used,
        limit: rl.limit,
      },
      { status: 429 },
    );
  }

  // Parse multipart
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid multipart: ${(err as Error).message}` },
      { status: 400 },
    );
  }
  const audio = form.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json(
      { error: 'Missing field `audio` (File)' },
      { status: 400 },
    );
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `Audio quá lớn (${audio.size} bytes > ${MAX_AUDIO_BYTES})` },
      { status: 413 },
    );
  }
  const language = (form.get('language')?.toString() ?? 'vi') as 'vi' | 'en' | 'auto';

  // Optional filters JSON
  const filtersRaw = form.get('filters')?.toString();
  let filters: Record<string, unknown> = {};
  if (filtersRaw) {
    try {
      filters = JSON.parse(filtersRaw);
    } catch {
      // ignore invalid filters JSON — chỉ skip
    }
  }

  // Transcribe
  let transcript: string;
  let detectedLanguage: string;
  try {
    const { client, model } = getWhisperClient();
    const result = await client.audio.transcriptions.create({
      file: audio,
      model,
      language: language === 'auto' ? undefined : language,
      response_format: 'verbose_json',
    });
    const raw = result as unknown as { text: string; language: string };
    transcript = (raw.text ?? '').trim();
    detectedLanguage = raw.language ?? language;
  } catch (err) {
    return NextResponse.json(
      { error: `Whisper fail: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (transcript.length < 2) {
    return NextResponse.json(
      { error: 'Transcript trống — vui lòng nói rõ hơn', transcript },
      { status: 422 },
    );
  }

  // Record usage (rate limit ledger) — fire-and-forget
  void recordVoiceUsage(session.user.id, transcript.length);

  // RAG search
  let hits: Awaited<ReturnType<typeof crossDocSearch>> = [];
  try {
    hits = await crossDocSearch({
      query: transcript,
      filters: filters as Parameters<typeof crossDocSearch>[0]['filters'],
      limit: 5,
    });
  } catch (err) {
    return NextResponse.json(
      {
        transcript,
        language: detectedLanguage,
        hits: [],
        searchError: (err as Error).message,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    transcript,
    language: detectedLanguage,
    hits,
    quota: { used: rl.used + 1, limit: rl.limit },
  });
}
