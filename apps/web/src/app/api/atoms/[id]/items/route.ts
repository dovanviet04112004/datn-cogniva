/**
 * GET /api/atoms/[id]/items — list flashcards + quiz questions + exam questions
 * của 1 atom. Optional ?workspaceId=X để scope.
 *
 * Phase C (atom-centric). Spec: docs/plans/atom-centric.md §5.1 (Atom detail).
 *
 * Returns:
 *   - flashcards: của user, optional scope workspace
 *   - quizQuestions: parent quiz info — không scope user (quiz có thể share)
 *   - examQuestions: parent exam info
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, desc, eq } from 'drizzle-orm';

import {
  concept,
  db,
  exam,
  examQuestion,
  flashcard,
  question,
  quiz,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: atomId } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspaceId');

  // Verify atom tồn tại
  const [atomRow] = await db
    .select({ id: concept.id })
    .from(concept)
    .where(eq(concept.id, atomId))
    .limit(1);
  if (!atomRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Flashcards của user, optional scope workspace
  const fcFilters = [
    eq(flashcard.userId, session.user.id),
    eq(flashcard.conceptId, atomId),
  ];
  if (workspaceId) fcFilters.push(eq(flashcard.workspaceId, workspaceId));

  const flashcards = await db
    .select({
      id: flashcard.id,
      front: flashcard.front,
      back: flashcard.back,
      cardType: flashcard.cardType,
      state: flashcard.state,
      due: flashcard.due,
      lastReview: flashcard.lastReview,
    })
    .from(flashcard)
    .where(and(...fcFilters))
    .orderBy(asc(flashcard.due))
    .limit(50);

  // Quiz questions có conceptId = atomId, kèm parent quiz info
  // Optional scope theo quiz.workspaceId nếu workspaceId được pass
  const qFilters = [eq(question.conceptId, atomId)];
  if (workspaceId) qFilters.push(eq(quiz.workspaceId, workspaceId));

  const quizQuestions = await db
    .select({
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      options: question.options,
      quizId: quiz.id,
      quizTitle: quiz.title,
      quizCreatedAt: quiz.createdAt,
    })
    .from(question)
    .innerJoin(quiz, eq(quiz.id, question.quizId))
    .where(and(...qFilters))
    .orderBy(desc(quiz.createdAt))
    .limit(50);

  // Exam questions — optional scope workspace
  const exFilters = [eq(examQuestion.conceptId, atomId)];
  if (workspaceId) exFilters.push(eq(exam.workspaceId, workspaceId));

  const examQuestions = await db
    .select({
      id: examQuestion.id,
      prompt: examQuestion.prompt,
      type: examQuestion.type,
      examId: exam.id,
      examTitle: exam.title,
    })
    .from(examQuestion)
    .innerJoin(exam, eq(exam.id, examQuestion.examId))
    .where(and(...exFilters))
    .orderBy(desc(exam.createdAt))
    .limit(50);

  return NextResponse.json({
    flashcards,
    quizQuestions,
    examQuestions,
  });
}
