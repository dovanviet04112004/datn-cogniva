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
 *   1. Resolve chunks scope-by-user (conceptId → chunks của atom).
 *   2. Lấy concept ID phổ biến nhất từ mỗi chunk (qua chunk_concept) để gán
 *      vào question.conceptId — phục vụ BKT update sau attempt.
 *   3. Sinh câu hỏi SONG SONG theo batch:
 *      - coverAll=true (Studio gen theo atom): phủ HẾT chunk của atom (tới trần
 *        COVER_ALL_MAX_CHUNKS), mỗi chunk COVER_ALL_PER_CHUNK câu — "gen đủ nội
 *        dung thì dừng", KHÔNG cap `count`.
 *      - coverAll=false: rải `count` câu đều trên chunks (tương thích cũ).
 *   4. Dedup theo conceptId: bỏ câu có prompt TRÙNG câu đã có của atom (question
 *      không lưu sourceChunkId nên dedup theo prompt) → bấm lại không đẻ trùng.
 *   5. INSERT quiz + questions.
 *
 * Best-effort: chunk gen fail → skip. Tổng câu sinh ra có thể < dự kiến.
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
import { onAtomChanged, onWorkspaceContentChanged } from '@/lib/cache/invalidate';
import {
  generateQuestions,
  type GeneratedQuestion,
  type QuestionType,
} from '@/lib/quiz/generate';
import { checkLimit } from '@/lib/rate-limit';
import type { Plan } from '@/lib/observability/cost-guardrail';

export const runtime = 'nodejs';

// Trần an toàn khi coverAll (chống atom khổng lồ → timeout). Phần dư trả `remaining`.
const COVER_ALL_MAX_CHUNKS = 40;
// Số câu/chunk khi coverAll (phủ nội dung, không cap tổng).
const COVER_ALL_PER_CHUNK = 2;
// Số chunk gen song song mỗi batch (cân bằng tốc độ vs rate-limit LLM free).
const GEN_CONCURRENCY = 5;

const SCHEMA = z.object({
  documentId: z.string().optional(),
  chunkIds: z.array(z.string()).optional(),
  // ATOM-TARGETED: gen quiz ĐÚNG 1 atom (concept) — resolve chunks của atom đó.
  conceptId: z.string().optional(),
  types: z
    .array(z.enum(['MCQ', 'TRUE_FALSE', 'SHORT']))
    .optional()
    .default(['MCQ', 'TRUE_FALSE', 'SHORT']),
  count: z.number().int().min(1).max(20).default(10),
  // coverAll=true → bỏ cap `count`, phủ HẾT chunk của atom. Studio bật cờ này.
  coverAll: z.boolean().optional().default(false),
  title: z.string().min(1).max(200).optional(),
});

/** Chuẩn hoá prompt để so trùng (dedup theo nội dung câu). */
function normPrompt(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = await checkLimit(`aigen:${session.user.id}`, 'aiGenerate');
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
  const { documentId, chunkIds, conceptId, types, count, coverAll, title } = parsed.data;
  if (!documentId && !conceptId && (!chunkIds || chunkIds.length === 0)) {
    return NextResponse.json(
      { error: 'Cần cung cấp documentId, conceptId hoặc chunkIds' },
      { status: 400 },
    );
  }

  // ATOM-TARGETED: resolve chunks của atom (concept) thuộc tài liệu của user.
  let atomChunkIds: string[] | null = null;
  if (conceptId) {
    const rows = await db
      .select({ id: chunkConcept.chunkId })
      .from(chunkConcept)
      .innerJoin(chunk, eq(chunk.id, chunkConcept.chunkId))
      .innerJoin(document, eq(document.id, chunk.documentId))
      .where(
        and(
          eq(chunkConcept.conceptId, conceptId),
          eq(document.userId, session.user.id),
        ),
      );
    atomChunkIds = rows.map((r) => r.id);
  }

  // Resolve chunks + workspaceId từ doc nguồn — quiz inherit workspace.
  const chunks = await db
    .select({
      id: chunk.id,
      content: chunk.content,
      documentId: chunk.documentId,
      workspaceId: document.workspaceId,
    })
    .from(chunk)
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(
      and(
        eq(document.userId, session.user.id),
        conceptId
          ? inArray(chunk.id, atomChunkIds ?? [])
          : documentId
            ? eq(chunk.documentId, documentId)
            : inArray(chunk.id, chunkIds ?? []),
      ),
    )
    .limit(50); // upper bound để tránh sinh quá nhiều

  if (chunks.length === 0) {
    return NextResponse.json({ error: 'Không có chunks phù hợp' }, { status: 404 });
  }

  // coverAll → phủ hết chunk của atom (tới trần); ngược lại dùng toàn bộ chunk
  // đã lấy (≤50) rồi cap theo `count` ở vòng gen.
  const targetChunks = coverAll ? chunks.slice(0, COVER_ALL_MAX_CHUNKS) : chunks;
  const remaining = coverAll ? chunks.length - targetChunks.length : 0;
  // Số câu/chunk: coverAll cố định; ngược lại rải `count` đều, ≥1.
  const perChunk = coverAll
    ? COVER_ALL_PER_CHUNK
    : Math.max(1, Math.ceil(count / targetChunks.length));

  // Lấy concept đại diện cho mỗi chunk (concept đầu tiên có strength cao nhất)
  const chunkIdList = targetChunks.map((c) => c.id);
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

  // Sinh questions SONG SONG theo batch (chống timeout khi coverAll phủ nhiều
  // chunk). Pass ctx để bật router cache — cùng chunk+types+count → cache hit.
  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  const genCtx = { userId: session.user.id, plan };
  const generated: Array<GeneratedQuestion & { chunkId: string }> = [];
  for (let i = 0; i < targetChunks.length; i += GEN_CONCURRENCY) {
    // Non-coverAll: dừng sớm khi đã đủ `count` (tiết kiệm LLM call).
    if (!coverAll && generated.length >= count) break;
    const batch = targetChunks.slice(i, i + GEN_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (ch) => ({
        ch,
        qs: await generateQuestions(
          ch.content,
          types as QuestionType[],
          perChunk,
          genCtx,
        ).catch(() => [] as GeneratedQuestion[]),
      })),
    );
    for (const { ch, qs } of batchResults) {
      for (const q of qs) generated.push({ ...q, chunkId: ch.id });
    }
  }
  // Non-coverAll: cap đúng `count` (batch có thể sinh dư trong batch cuối).
  if (!coverAll && generated.length > count) generated.length = count;

  // DEDUP theo conceptId: bỏ câu có prompt trùng câu ĐÃ CÓ của atom (+ trùng
  // nội bộ lần gen này) → bấm "Tạo quiz" lại không đẻ câu trùng.
  let deduped = generated;
  if (conceptId && generated.length > 0) {
    const existingQ = await db
      .select({ prompt: question.prompt })
      .from(question)
      .where(eq(question.conceptId, conceptId));
    const seen = new Set(existingQ.map((r) => normPrompt(r.prompt)));
    deduped = generated.filter((q) => {
      const key = normPrompt(q.prompt);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  if (deduped.length === 0) {
    // Không có câu mới (atom đã phủ đủ) → không tạo quiz rỗng.
    return NextResponse.json({ quiz: null, questions: [], remaining });
  }
  const finalQuestions = deduped;

  // INSERT quiz + questions. Quiz inherit workspaceId từ doc đầu tiên trong
  // chunks (giả thiết các chunk cùng doc; nếu mix doc → lấy doc đầu).
  const inheritedWorkspaceId = chunks[0]?.workspaceId ?? null;
  const [insertedQuiz] = await db
    .insert(quiz)
    .values({
      userId: session.user.id,
      workspaceId: inheritedWorkspaceId,
      title:
        title ??
        `Quiz ${new Date().toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}`,
      config: { types, questionCount: finalQuestions.length },
    })
    .returning();

  if (!insertedQuiz) {
    return NextResponse.json({ error: 'Tạo quiz thất bại' }, { status: 500 });
  }

  const insertedQuestions = await db
    .insert(question)
    .values(
      finalQuestions.map((q) => ({
        quizId: insertedQuiz.id,
        type: q.type,
        prompt: q.prompt,
        options: q.type === 'MCQ' ? q.options : null,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        // Gen-THEO-ATOM (request có conceptId) → gắn ĐÚNG atom target để QUIZ count
        // của atom đó tăng + dedup-theo-concept khớp. Gen-theo-doc → concept mạnh
        // nhất của chunk.
        conceptId: conceptId ?? chunkToConcept.get(q.chunkId) ?? null,
        difficulty: q.difficulty,
      })),
    )
    .returning();

  // Quiz mới đổi badge stats workspace (count quizzes) → bust workspaceStats/atoms.
  // Quiz inherit workspaceId từ doc nguồn; chỉ bust khi inherit được workspace cụ thể.
  if (inheritedWorkspaceId) {
    await onWorkspaceContentChanged(session.user.id, inheritedWorkspaceId);
  }
  // Atom-targeted → quiz count của atom đổi → bust atom-view preview.
  if (conceptId) await onAtomChanged(session.user.id, conceptId);

  return NextResponse.json({
    quiz: insertedQuiz,
    questions: insertedQuestions,
    remaining,
  });
}
