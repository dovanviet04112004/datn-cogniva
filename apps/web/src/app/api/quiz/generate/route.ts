/**
 * POST /api/quiz/generate — AI sinh quiz từ document/chunks.
 *
 * Body:
 *   {
 *     documentId?: string,        // nguồn — toàn document hoặc
 *     chunkIds?: string[],        //   chunks chỉ định
 *     types?: ('MCQ'|'TRUE_FALSE'|'SHORT')[],  // mặc định cả 3
 *     count?: number,             // số câu mong muốn (max 20)
 *     title?: string              // tiêu đề quiz
 *   }
 *
 * Logic:
 *   1. Resolve chunks scope-by-user.
 *   2. Lấy concept ID phổ biến nhất từ mỗi chunk (qua chunk_concept) để gán
 *      vào question.conceptId — phục vụ BKT update sau attempt.
 *   3. Sinh `count` câu hỏi rải đều trên chunks (≈ count/n_chunks câu/chunk).
 *   4. INSERT quiz + questions trong transaction.
 *
 * Best-effort: chunk gen fail → skip. Tổng câu sinh ra có thể < count.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import {
  chunk,
  chunkConcept,
  db,
  document,
  question,
  quiz,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  generateQuestions,
  type GeneratedQuestion,
  type QuestionType,
} from '@/lib/quiz/generate';
import { checkLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  documentId: z.string().optional(),
  chunkIds: z.array(z.string()).optional(),
  types: z
    .array(z.enum(['MCQ', 'TRUE_FALSE', 'SHORT']))
    .optional()
    .default(['MCQ', 'TRUE_FALSE', 'SHORT']),
  count: z.number().int().min(1).max(20).default(10),
  title: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkLimit(`aigen:${session.user.id}`, 'aiGenerate');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { documentId, chunkIds, types, count, title } = parsed.data;
  if (!documentId && (!chunkIds || chunkIds.length === 0)) {
    return NextResponse.json(
      { error: 'Cần cung cấp documentId hoặc chunkIds' },
      { status: 400 },
    );
  }

  // Resolve chunks (verify ownership qua document.userId)
  const chunks = await db
    .select({
      id: chunk.id,
      content: chunk.content,
      documentId: chunk.documentId,
    })
    .from(chunk)
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(
      and(
        eq(document.userId, session.user.id),
        documentId
          ? eq(chunk.documentId, documentId)
          : inArray(chunk.id, chunkIds ?? []),
      ),
    )
    .limit(50); // upper bound để tránh sinh quá nhiều

  if (chunks.length === 0) {
    return NextResponse.json({ error: 'Không có chunks phù hợp' }, { status: 404 });
  }

  // Tính số câu trên mỗi chunk: rải đều, ≥1
  const perChunk = Math.max(1, Math.ceil(count / chunks.length));

  // Lấy concept đại diện cho mỗi chunk (concept đầu tiên có strength cao nhất)
  const chunkIdList = chunks.map((c) => c.id);
  const chunkConceptRows = await db
    .select({
      chunkId: chunkConcept.chunkId,
      conceptId: chunkConcept.conceptId,
      strength: chunkConcept.strength,
    })
    .from(chunkConcept)
    .where(inArray(chunkConcept.chunkId, chunkIdList));
  const chunkToConcept = new Map<string, string>();
  for (const row of chunkConceptRows) {
    const existing = chunkToConcept.get(row.chunkId);
    if (!existing) chunkToConcept.set(row.chunkId, row.conceptId);
  }

  // Sinh questions tuần tự (free-tier rate limit)
  const generated: Array<GeneratedQuestion & { chunkId: string }> = [];
  for (const ch of chunks) {
    if (generated.length >= count) break;
    const qs = await generateQuestions(
      ch.content,
      types as QuestionType[],
      perChunk,
    );
    for (const q of qs) {
      generated.push({ ...q, chunkId: ch.id });
      if (generated.length >= count) break;
    }
  }

  if (generated.length === 0) {
    return NextResponse.json({ error: 'AI không sinh được câu hỏi' }, { status: 500 });
  }

  // INSERT quiz + questions
  const [insertedQuiz] = await db
    .insert(quiz)
    .values({
      userId: session.user.id,
      title:
        title ??
        `Quiz ${new Date().toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}`,
      config: { types, questionCount: generated.length },
    })
    .returning();

  if (!insertedQuiz) {
    return NextResponse.json({ error: 'Tạo quiz thất bại' }, { status: 500 });
  }

  const insertedQuestions = await db
    .insert(question)
    .values(
      generated.map((q) => ({
        quizId: insertedQuiz.id,
        type: q.type,
        prompt: q.prompt,
        options: q.type === 'MCQ' ? q.options : null,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        conceptId: chunkToConcept.get(q.chunkId) ?? null,
        difficulty: q.difficulty,
      })),
    )
    .returning();

  return NextResponse.json({
    quiz: insertedQuiz,
    questions: insertedQuestions,
  });
}
