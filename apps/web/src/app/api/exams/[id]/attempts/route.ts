/**
 * POST /api/exams/[id]/attempts — student start làm exam.
 *
 * Pre-check:
 *   - Exam PUBLISHED (DRAFT student không thấy được; ENDED không start mới)
 *   - User chưa vượt `maxAttempts` (count attempts của user cho exam này)
 *   - ASYNC mode: now() phải trong window [startsAt, endsAt]
 *
 * Return: { attempt: ExamAttempt } — client redirect sang /exams/[id]/take?aid=...
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, count, eq } from 'drizzle-orm';

import { db, exam, examAttempt } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const userId = session.user.id;

  const [parent] = await db.select().from(exam).where(eq(exam.id, id)).limit(1);
  if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (parent.status === 'DRAFT' || parent.status === 'ENDED') {
    return NextResponse.json(
      { error: `Exam status không cho phép start: ${parent.status}` },
      { status: 403 },
    );
  }

  if (parent.mode === 'ASYNC') {
    const now = new Date();
    if (parent.startsAt && now < parent.startsAt) {
      return NextResponse.json(
        { error: 'Exam chưa mở. Bắt đầu lúc ' + parent.startsAt.toISOString() },
        { status: 403 },
      );
    }
    if (parent.endsAt && now > parent.endsAt) {
      return NextResponse.json(
        { error: 'Exam đã đóng. Kết thúc lúc ' + parent.endsAt.toISOString() },
        { status: 403 },
      );
    }
  }

  // Check attempt count
  const [cnt] = await db
    .select({ n: count() })
    .from(examAttempt)
    .where(and(eq(examAttempt.examId, id), eq(examAttempt.userId, userId)));
  if (cnt && cnt.n >= parent.maxAttempts) {
    return NextResponse.json(
      { error: `Đã đạt giới hạn ${parent.maxAttempts} lần làm bài` },
      { status: 409 },
    );
  }

  // Tránh tạo attempt mới khi đang có 1 attempt IN_PROGRESS — return cái cũ
  const [inProgress] = await db
    .select()
    .from(examAttempt)
    .where(
      and(
        eq(examAttempt.examId, id),
        eq(examAttempt.userId, userId),
        eq(examAttempt.status, 'IN_PROGRESS'),
      ),
    )
    .limit(1);
  if (inProgress) {
    return NextResponse.json({ attempt: inProgress, resumed: true });
  }

  const ipAddress =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const userAgent = request.headers.get('user-agent');

  const [attempt] = await db
    .insert(examAttempt)
    .values({
      examId: id,
      userId,
      status: 'IN_PROGRESS',
      maxScore: parent.maxScore,
      ipAddress,
      userAgent,
    })
    .returning();

  return NextResponse.json({ attempt, resumed: false }, { status: 201 });
}
