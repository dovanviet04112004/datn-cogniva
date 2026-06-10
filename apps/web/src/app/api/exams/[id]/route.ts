/**
 * GET    /api/exams/[id] — detail + questions (owner luôn thấy; student chỉ
 *                          khi PUBLISHED + maxScore > 0)
 * PUT    /api/exams/[id] — update metadata (owner only, status=DRAFT)
 * DELETE /api/exams/[id] — soft delete? KHÔNG — hard delete vì có FK cascade,
 *                          attempt user mất theo (chấp nhận trade-off Phase 16)
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, exam, examQuestion } from '@cogniva/db';
import { auth } from '@/lib/auth';
import { onExamChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

const UPDATE_SCHEMA = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  mode: z.enum(['PRACTICE', 'TIMED']).optional(),
  durationSeconds: z.number().int().positive().nullable().optional(),
  /** ISO timestamp — đồng loạt start time (TIMED proctored exam). NULL = student tự bấm. */
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  passingScore: z.number().min(0).max(1).nullable().optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  allowReview: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  showResults: z.enum(['IMMEDIATE', 'AFTER_SUBMIT', 'AFTER_ALL_DONE']).optional(),
  /** Phase 19 — anti-cheat config jsonb. */
  antiCheat: z.object({
    requireFullscreen: z.boolean().optional(),
    blockTabSwitch: z.boolean().optional(),
    blockCopyPaste: z.boolean().optional(),
    blockContextMenu: z.boolean().optional(),
    detectDevtools: z.boolean().optional(),
    requireWebcam: z.boolean().optional(),
    requireMic: z.boolean().optional(),
    aiProctor: z.boolean().optional(),
  }).optional(),
});

export async function GET(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [row] = await db.select().from(exam).where(eq(exam.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isOwner = row.ownerId === session.user.id;
  if (!isOwner && row.status === 'DRAFT') {
    // Student không xem được DRAFT
    return NextResponse.json({ error: 'Exam chưa publish' }, { status: 403 });
  }

  // Load questions theo orderIndex.
  //   Owner: luôn thấy đầy đủ (correctAnswer + rubric) để builder edit/preview.
  //   Student: KHÔNG thấy nội dung câu hỏi ở trang detail (chống đọc trước rồi
  //     mới start timer). Chỉ thấy count + sample meta (loại câu, điểm) qua
  //     `questionCount`. Khi vào /take/[attemptId], API attempts mới trả prompt.
  const questions = await db
    .select()
    .from(examQuestion)
    .where(eq(examQuestion.examId, id))
    .orderBy(asc(examQuestion.orderIndex));

  const stripped = isOwner ? questions : [];

  return NextResponse.json({
    exam: row,
    questions: stripped,
    questionCount: questions.length,
    isOwner,
  });
}

export async function PUT(request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [row] = await db.select().from(exam).where(eq(exam.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (row.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'Chỉ exam DRAFT mới edit được. Hiện status: ' + row.status },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = UPDATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Khi đổi mode → TIMED bắt buộc có durationSeconds (body hoặc cũ).
  const updates: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.startsAt !== undefined) {
    updates.startsAt = parsed.data.startsAt ? new Date(parsed.data.startsAt) : null;
  }
  if (parsed.data.endsAt !== undefined) {
    updates.endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  }
  if (parsed.data.mode === 'TIMED') {
    const finalDuration = parsed.data.durationSeconds ?? row.durationSeconds;
    if (!finalDuration) {
      return NextResponse.json(
        { error: 'TIMED mode bắt buộc có durationSeconds' },
        { status: 400 },
      );
    }
  }

  const [updated] = await db
    .update(exam)
    .set(updates)
    .where(eq(exam.id, id))
    .returning();
  if (!updated) return NextResponse.json({ error: 'Failed to update exam' }, { status: 500 });

  // Metadata exam đổi (title/mode/...) → bust list exams owner + stats workspace.
  await onExamChanged(updated.ownerId, updated.workspaceId);

  return NextResponse.json({ exam: updated });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  // Lấy thêm workspaceId để invalidate đúng key list theo workspace + stats.
  const [row] = await db
    .select({ ownerId: exam.ownerId, status: exam.status, workspaceId: exam.workspaceId })
    .from(exam)
    .where(eq(exam.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.delete(exam).where(eq(exam.id, id));

  // Exam bị xoá → bust list exams owner + badge stats workspace (count exam --).
  await onExamChanged(row.ownerId, row.workspaceId);

  return NextResponse.json({ ok: true });
}
