/**
 * /api/quiz/[id] — chi tiết quiz + danh sách câu hỏi.
 *
 * GET: trả quiz + questions (KHÔNG kèm correctAnswer khi đang làm bài).
 *   Frontend đặt query ?withAnswers=1 nếu muốn xem đáp án (sau khi attempt xong).
 * DELETE: xoá quiz (cascade questions).
 *
 * Auth: scope qua quiz.userId.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, question, quiz } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onWorkspaceContentChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db
    .select()
    .from(quiz)
    .where(and(eq(quiz.id, id), eq(quiz.userId, session.user.id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(request.url);
  const withAnswers = url.searchParams.get('withAnswers') === '1';

  const questions = await db
    .select()
    .from(question)
    .where(eq(question.quizId, id));

  // Khi đang làm bài, ẩn correctAnswer + explanation để tránh client lộ
  const payload = withAnswers
    ? questions
    : questions.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        conceptId: q.conceptId,
        difficulty: q.difficulty,
      }));

  return NextResponse.json({ quiz: row, questions: payload });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Lấy kèm workspaceId từ .returning() để biết workspace nào cần bust badge stats.
  const result = await db
    .delete(quiz)
    .where(and(eq(quiz.id, id), eq(quiz.userId, session.user.id)))
    .returning({ id: quiz.id, workspaceId: quiz.workspaceId });
  if (result.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Quiz bị xoá đổi count quizzes của workspace → bust workspaceStats/atoms.
  // Chỉ khi quiz thuộc workspace cụ thể (quiz có thể có workspaceId=null).
  const deletedWorkspaceId = result[0]?.workspaceId;
  if (deletedWorkspaceId) {
    await onWorkspaceContentChanged(session.user.id, deletedWorkspaceId);
  }

  return NextResponse.json({ deleted: true });
}
