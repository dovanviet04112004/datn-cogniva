/**
 * GET /api/workspaces/[id]/manage — danh sách flashcard + câu hỏi của workspace
 * cho trang QUẢN TRỊ (xem lại + cột "đã làm/chưa làm").
 *
 * - Flashcard: "đã làm" = đã ôn (lastReview != null). Kèm atom + loại + trạng thái FSRS.
 * - Câu hỏi quiz: "đã làm" = có quiz_response của user cho câu đó (full attempt
 *   HOẶC quick-quiz marker). Kèm atom + loại + tên quiz + đúng/sai gần nhất.
 *
 * Đọc từ PRIMARY (read-your-own-write): vừa ôn/làm xong mở quản trị thấy ngay,
 * không lệ thuộc replica lag. Endpoint nhẹ + mở theo nhu cầu → không cache Redis;
 * client React Query cache + invalidate sau mỗi hành động.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  concept,
  db,
  flashcard,
  question,
  quiz,
  quizResponse,
  workspace,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: workspaceId } = await params;
  const userId = session.user.id;

  // Verify ownership
  const [ws] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.userId, userId)))
    .limit(1);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── Flashcards của workspace ────────────────────────────────────────────
  const fcRows = await db
    .select({
      id: flashcard.id,
      front: flashcard.front,
      back: flashcard.back,
      cardType: flashcard.cardType,
      state: flashcard.state,
      due: flashcard.due,
      lastReview: flashcard.lastReview,
      conceptId: flashcard.conceptId,
    })
    .from(flashcard)
    .where(and(eq(flashcard.userId, userId), eq(flashcard.workspaceId, workspaceId)))
    .orderBy(sql`${flashcard.lastReview} DESC NULLS LAST`);

  // ── Quiz + câu hỏi của workspace ────────────────────────────────────────
  const quizzes = await db
    .select({ id: quiz.id, title: quiz.title })
    .from(quiz)
    .where(and(eq(quiz.userId, userId), eq(quiz.workspaceId, workspaceId)));
  const quizTitleById = new Map(quizzes.map((q) => [q.id, q.title]));
  const quizIds = quizzes.map((q) => q.id);

  const qRows =
    quizIds.length > 0
      ? await db
          .select({
            id: question.id,
            prompt: question.prompt,
            type: question.type,
            conceptId: question.conceptId,
            quizId: question.quizId,
          })
          .from(question)
          .where(inArray(question.quizId, quizIds))
      : [];

  // "Đã làm" + đúng/sai gần nhất theo từng câu (quiz_response, lấy bản mới nhất).
  const qIds = qRows.map((q) => q.id);
  const answeredByQuestion = new Map<
    string,
    { isCorrect: boolean | null; answeredAt: Date | null }
  >();
  if (qIds.length > 0) {
    const responses = await db
      .select({
        questionId: quizResponse.questionId,
        isCorrect: quizResponse.isCorrect,
        answeredAt: quizResponse.answeredAt,
      })
      .from(quizResponse)
      .where(and(eq(quizResponse.userId, userId), inArray(quizResponse.questionId, qIds)))
      .orderBy(desc(quizResponse.answeredAt));
    for (const r of responses) {
      // responses sort mới→cũ → bản đầu gặp mỗi câu là gần nhất.
      if (!answeredByQuestion.has(r.questionId)) {
        answeredByQuestion.set(r.questionId, {
          isCorrect: r.isCorrect,
          answeredAt: r.answeredAt,
        });
      }
    }
  }

  // ── Tên atom (concept) cho cả 2 danh sách ───────────────────────────────
  const conceptIds = [
    ...new Set(
      [...fcRows, ...qRows]
        .map((r) => r.conceptId)
        .filter((c): c is string => c !== null),
    ),
  ];
  const conceptNameById = new Map<string, string>();
  if (conceptIds.length > 0) {
    const cRows = await db
      .select({ id: concept.id, name: concept.name })
      .from(concept)
      .where(inArray(concept.id, conceptIds));
    for (const c of cRows) conceptNameById.set(c.id, c.name);
  }

  const flashcards = fcRows.map((f) => ({
    id: f.id,
    front: f.front,
    back: f.back,
    cardType: f.cardType,
    state: f.state,
    due: f.due?.toISOString() ?? null,
    lastReview: f.lastReview?.toISOString() ?? null,
    atomName: f.conceptId ? (conceptNameById.get(f.conceptId) ?? null) : null,
    done: f.lastReview !== null,
  }));

  const questions = qRows.map((q) => {
    const ans = answeredByQuestion.get(q.id);
    return {
      id: q.id,
      prompt: q.prompt,
      type: q.type,
      quizTitle: quizTitleById.get(q.quizId) ?? null,
      atomName: q.conceptId ? (conceptNameById.get(q.conceptId) ?? null) : null,
      done: ans !== undefined,
      lastCorrect: ans?.isCorrect ?? null,
      answeredAt: ans?.answeredAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ flashcards, questions });
}
