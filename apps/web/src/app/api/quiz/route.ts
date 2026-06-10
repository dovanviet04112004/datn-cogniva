/**
 * /api/quiz — list quizzes của user.
 *
 * GET:
 *   ?limit=50&offset=0
 *   Trả mảng quizzes kèm count questions để UI render list.
 *
 * Auth: session.user.id, scope qua quiz.userId.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db, question, quiz } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);
  const workspaceParam = url.searchParams.get('workspaceId');

  const filters = [eq(quiz.userId, session.user.id)];
  if (workspaceParam === 'null') {
    filters.push(isNull(quiz.workspaceId));
  } else if (workspaceParam) {
    filters.push(eq(quiz.workspaceId, workspaceParam));
  }

  // LEFT JOIN COUNT subquery: lấy số question / quiz
  const rows = await db
    .select({
      id: quiz.id,
      title: quiz.title,
      workspaceId: quiz.workspaceId,
      config: quiz.config,
      createdAt: quiz.createdAt,
      questionCount: sql<number>`coalesce(count(${question.id}), 0)::int`,
    })
    .from(quiz)
    .leftJoin(question, eq(question.quizId, quiz.id))
    .where(and(...filters))
    .groupBy(quiz.id)
    .orderBy(desc(quiz.createdAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({ quizzes: rows });
}
