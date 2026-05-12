/**
 * GET /api/attempts/[id] — load attempt + responses + questions (đã shuffle).
 *
 * Owner attempt: chỉ student làm bài + owner của exam mới xem.
 * Result page sau submit: include correctAnswer + explanation.
 * Trong khi IN_PROGRESS: chỉ trả response của user (không leak correct).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';

import {
  db,
  exam,
  examAttempt,
  examQuestion,
  examResponse,
} from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [attempt] = await db.select().from(examAttempt).where(eq(examAttempt.id, id)).limit(1);
  if (!attempt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [parent] = await db.select().from(exam).where(eq(exam.id, attempt.examId)).limit(1);
  if (!parent) return NextResponse.json({ error: 'Exam not found' }, { status: 404 });

  const isOwner = parent.ownerId === session.user.id;
  const isStudent = attempt.userId === session.user.id;
  if (!isOwner && !isStudent) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Load questions theo orderIndex hiện có (shuffle KHÔNG ở backend mà ở UI
  // khi exam.shuffleQuestions = true — backend trả thứ tự gốc, student nhận
  // shuffled theo deterministic seed = attemptId để consistent qua reload)
  const questions = await db
    .select()
    .from(examQuestion)
    .where(eq(examQuestion.examId, attempt.examId))
    .orderBy(asc(examQuestion.orderIndex));

  const responses = await db
    .select()
    .from(examResponse)
    .where(eq(examResponse.attemptId, id));

  // Show correctAnswer/explanation khi:
  //   1. attempt SUBMITTED + exam.showResults = IMMEDIATE/AFTER_SUBMIT
  //   2. OR isOwner (luôn thấy)
  const submitted = attempt.status !== 'IN_PROGRESS';
  const reveal = isOwner || (submitted && parent.showResults !== 'AFTER_ALL_DONE');

  const strippedQuestions = reveal
    ? questions
    : questions.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        promptHtml: q.promptHtml,
        attachments: q.attachments,
        options: q.options,
        points: q.points,
        timeLimitSeconds: q.timeLimitSeconds,
        orderIndex: q.orderIndex,
      }));

  return NextResponse.json({
    attempt,
    exam: {
      id: parent.id,
      title: parent.title,
      description: parent.description,
      mode: parent.mode,
      status: parent.status,
      durationSeconds: parent.durationSeconds,
      maxScore: parent.maxScore,
      passingScore: parent.passingScore,
      shuffleQuestions: parent.shuffleQuestions,
      shuffleOptions: parent.shuffleOptions,
      allowReview: parent.allowReview,
      showResults: parent.showResults,
    },
    questions: strippedQuestions,
    responses,
    reveal,
    isOwner,
  });
}
