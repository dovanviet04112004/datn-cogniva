/**
 * GET  /api/exams — list exam mà user là owner (Phase 16 chưa share/classroom)
 * POST /api/exams — tạo exam DRAFT
 *
 * Future endpoints (Phase 17+):
 *   - List exam student được assign qua classroom
 *   - List public exam (TOURNAMENT mode)
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, exam } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const CREATE_SCHEMA = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  mode: z.enum(['PRACTICE', 'TIMED', 'LIVE', 'ASYNC', 'ADAPTIVE', 'TOURNAMENT']).default('PRACTICE'),
  durationSeconds: z.number().int().positive().optional(),
  passingScore: z.number().min(0).max(1).optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  allowReview: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  showResults: z.enum(['IMMEDIATE', 'AFTER_SUBMIT', 'AFTER_ALL_DONE']).optional(),
});

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select({
      id: exam.id,
      title: exam.title,
      description: exam.description,
      mode: exam.mode,
      status: exam.status,
      durationSeconds: exam.durationSeconds,
      maxScore: exam.maxScore,
      maxAttempts: exam.maxAttempts,
      createdAt: exam.createdAt,
      publishedAt: exam.publishedAt,
    })
    .from(exam)
    .where(eq(exam.ownerId, session.user.id))
    .orderBy(desc(exam.createdAt));

  return NextResponse.json({ exams: rows });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // TIMED mode → require durationSeconds; LIVE → generate liveCode
  if (parsed.data.mode === 'TIMED' && !parsed.data.durationSeconds) {
    return NextResponse.json(
      { error: 'TIMED mode bắt buộc có durationSeconds' },
      { status: 400 },
    );
  }
  const liveCode =
    parsed.data.mode === 'LIVE'
      ? generateLiveCode()
      : null;

  const [created] = await db
    .insert(exam)
    .values({
      ownerId: session.user.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      mode: parsed.data.mode,
      durationSeconds: parsed.data.durationSeconds ?? null,
      passingScore: parsed.data.passingScore ?? null,
      shuffleQuestions: parsed.data.shuffleQuestions ?? true,
      shuffleOptions: parsed.data.shuffleOptions ?? true,
      allowReview: parsed.data.allowReview ?? true,
      maxAttempts: parsed.data.maxAttempts ?? 1,
      showResults: parsed.data.showResults ?? 'IMMEDIATE',
      liveCode,
    })
    .returning();

  return NextResponse.json({ exam: created }, { status: 201 });
}

/**
 * Generate 6-ký-tự code A-Z (loại 0/O/1/I/L để dễ đọc). UNIQUE check ở DB
 * level qua `exam_live_code_idx`. Collision rate ~1/3M (26^6 / 6 char) — chấp
 * nhận retry ở UI nếu bao giờ trùng.
 */
function generateLiveCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
