/**
 * POST /api/exams/[id]/generate-questions — AI sinh examQuestion từ document.
 *
 * Body:
 *   {
 *     documentId?: string,    // nguồn — toàn document
 *     chunkIds?: string[],    //  hoặc chunks chỉ định
 *     types?: ('MCQ'|'TRUE_FALSE'|'SHORT')[],
 *     count?: number          // số câu, max 30 (cao hơn quiz vì exam)
 *   }
 *
 * Tái dùng `generateQuestions()` từ lib/quiz, MAP type → examQuestion type:
 *   MCQ        → MCQ_SINGLE (Phase 16 chỉ gen single, multi-select manual)
 *   TRUE_FALSE → TRUE_FALSE
 *   SHORT      → SHORT
 *
 * Owner only, DRAFT exam only. Insert examQuestion rows tiếp theo orderIndex.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { chunk, chunkConcept, db, document, exam, examQuestion } from '@cogniva/db';
import { auth } from '@/lib/auth';
import {
  generateQuestions,
  type GeneratedQuestion,
  type QuestionType,
} from '@/lib/quiz/generate';
import { checkLimit } from '@/lib/rate-limit';
import type { Plan } from '@/lib/observability/cost-guardrail';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

const SCHEMA = z.object({
  documentId: z.string().optional(),
  chunkIds: z.array(z.string()).optional(),
  types: z
    .array(z.enum(['MCQ', 'TRUE_FALSE', 'SHORT']))
    .optional()
    .default(['MCQ', 'TRUE_FALSE', 'SHORT']),
  count: z.number().int().min(1).max(30).default(10),
});

/** Map type từ quiz generator → exam_question type. */
function mapType(t: QuestionType): string {
  if (t === 'MCQ') return 'MCQ_SINGLE';
  return t;
}

export async function POST(request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  // Rate limit AI gen (preset aiGenerate)
  const rl = await checkLimit(`aigen:${session.user.id}`, 'aiGenerate');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  const [parent] = await db
    .select({ ownerId: exam.ownerId, status: exam.status })
    .from(exam)
    .where(eq(exam.id, id))
    .limit(1);
  if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (parent.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (parent.status !== 'DRAFT') {
    return NextResponse.json(
      { error: `Chỉ DRAFT mới gen câu hỏi. Hiện: ${parent.status}` },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { documentId, chunkIds, types, count } = parsed.data;
  if (!documentId && (!chunkIds || chunkIds.length === 0)) {
    return NextResponse.json(
      { error: 'Cần documentId hoặc chunkIds' },
      { status: 400 },
    );
  }

  // Resolve chunks (verify ownership qua document.userId)
  const chunks = await db
    .select({
      id: chunk.id,
      content: chunk.content,
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
    .limit(50);

  if (chunks.length === 0) {
    return NextResponse.json({ error: 'Không có chunks phù hợp' }, { status: 404 });
  }

  const perChunk = Math.max(1, Math.ceil(count / chunks.length));

  // Map chunk → concept đại diện
  const chunkConceptRows = await db
    .select({
      chunkId: chunkConcept.chunkId,
      conceptId: chunkConcept.conceptId,
    })
    .from(chunkConcept)
    .where(inArray(chunkConcept.chunkId, chunks.map((c) => c.id)));
  const chunkToConcept = new Map<string, string>();
  for (const row of chunkConceptRows) {
    if (!chunkToConcept.has(row.chunkId)) chunkToConcept.set(row.chunkId, row.conceptId);
  }

  // Gen tuần tự (free-tier rate limit). Pass ctx để bật router cache —
  // cùng chunk + cùng types/count → cache hit shared scope.
  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  const genCtx = { userId: session.user.id, plan };
  const generated: Array<GeneratedQuestion & { chunkId: string }> = [];
  for (const ch of chunks) {
    if (generated.length >= count) break;
    const qs = await generateQuestions(ch.content, types as QuestionType[], perChunk, genCtx);
    for (const q of qs) {
      generated.push({ ...q, chunkId: ch.id });
      if (generated.length >= count) break;
    }
  }

  if (generated.length === 0) {
    return NextResponse.json({ error: 'AI không sinh được câu hỏi' }, { status: 500 });
  }

  // Get next orderIndex
  const [maxOrder] = await db
    .select({ max: sql<number>`coalesce(max(${examQuestion.orderIndex}), -1)::int` })
    .from(examQuestion)
    .where(eq(examQuestion.examId, id));
  let nextIndex = (maxOrder?.max ?? -1) + 1;

  // Insert tất cả questions cùng lúc
  const insertValues = generated.map((q) => ({
    examId: id,
    type: mapType(q.type),
    prompt: q.prompt,
    options: q.type === 'MCQ' ? (q.options as never) : null,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    conceptId: chunkToConcept.get(q.chunkId) ?? null,
    difficulty: q.difficulty,
    points: 1,
    orderIndex: nextIndex++,
  }));

  const inserted = await db.insert(examQuestion).values(insertValues).returning();

  return NextResponse.json({ questions: inserted, count: inserted.length });
}
