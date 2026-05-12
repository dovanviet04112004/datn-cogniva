/**
 * POST /api/exams/[id]/publish — DRAFT → PUBLISHED.
 *
 * Pre-check:
 *   - Owner only
 *   - Status hiện tại = DRAFT
 *   - Có ≥ 1 examQuestion
 *   - Cache maxScore = sum(question.points)
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';

import { db, exam, examQuestion } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: RouteContext) {
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
      { error: `Chỉ DRAFT mới publish được. Hiện: ${row.status}` },
      { status: 409 },
    );
  }

  // Aggregate maxScore từ questions
  const [agg] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${examQuestion.points}), 0)::real`,
    })
    .from(examQuestion)
    .where(eq(examQuestion.examId, id));

  if (!agg || agg.count === 0) {
    return NextResponse.json(
      { error: 'Exam chưa có câu hỏi nào — thêm trước khi publish' },
      { status: 409 },
    );
  }

  const [published] = await db
    .update(exam)
    .set({
      status: 'PUBLISHED',
      publishedAt: new Date(),
      maxScore: agg.total,
    })
    .where(eq(exam.id, id))
    .returning();

  return NextResponse.json({ exam: published });
}
