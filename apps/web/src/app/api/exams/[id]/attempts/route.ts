/**
 * GET  /api/exams/[id]/attempts — list user's attempts cho exam này (history).
 * POST /api/exams/[id]/attempts — start làm exam (tạo attempt mới hoặc resume).
 *
 * GET dùng cho StudioExamInlinePreview (V8.24) để hiện lịch sử score + cho
 * student resume attempt đang dở. Trả attempts của CHÍNH session user (không
 * leak attempt user khác).
 *
 * POST pre-check:
 *   - Exam PUBLISHED (DRAFT student không thấy được; ENDED không start mới)
 *   - User chưa vượt `maxAttempts` (count attempts của user cho exam này)
 *   - ASYNC mode: now() phải trong window [startsAt, endsAt]
 *
 * Return POST: { attempt: ExamAttempt } — client redirect /exams/[id]/take?aid=...
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, count, desc, eq } from 'drizzle-orm';

import { db, exam, examAttempt } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const userId = session.user.id;

  // Exam meta + attempts của user fetch song song — independent queries,
  // chấp nhận thêm 1 query nếu exam DRAFT (filter sau).
  const [examRows, attemptRows] = await Promise.all([
    db
      .select({ ownerId: exam.ownerId, status: exam.status })
      .from(exam)
      .where(eq(exam.id, id))
      .limit(1),
    db
      .select({
        id: examAttempt.id,
        status: examAttempt.status,
        score: examAttempt.score,
        maxScore: examAttempt.maxScore,
        percentage: examAttempt.percentage,
        startedAt: examAttempt.startedAt,
        submittedAt: examAttempt.submittedAt,
      })
      .from(examAttempt)
      .where(and(eq(examAttempt.examId, id), eq(examAttempt.userId, userId)))
      .orderBy(desc(examAttempt.startedAt))
      .limit(20),
  ]);

  const parent = examRows[0];
  if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Student không list được attempts của exam DRAFT (tự nhiên = 0)
  if (parent.status === 'DRAFT' && parent.ownerId !== userId) {
    return NextResponse.json({ attempts: [] });
  }

  return NextResponse.json({ attempts: attemptRows });
}

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

  // Check attempt count — Practice mode bypass (luyện tập = unlimited).
  // Owner BYPASS hoàn toàn (đang "Làm thử" preview UX, không tính fairness).
  // Student TIMED bị enforce maxAttempts để fairness khi chấm điểm.
  const isOwner = parent.ownerId === userId;
  if (parent.mode !== 'PRACTICE' && !isOwner) {
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
