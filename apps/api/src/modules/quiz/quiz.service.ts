/**
 * QuizService — list / detail / delete / AI generate. Port từ
 * apps/web/src/app/api/quiz/{,generate,[id]}/route.ts — GIỮ NGUYÊN wire shape
 * (camelCase + thứ tự field như row Drizzle cũ) + cùng invalidator
 * (@cogniva/server-core) để Next/Nest sống chung không lệch cache.
 */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type question as QuestionRow, type quiz as QuizRow } from '@prisma/client';
import { onAtomChanged, onWorkspaceContentChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import type { Plan } from '../../infra/ai/cost-guardrail.service';
import { QuizGenerateService, type GeneratedQuestion } from './quiz-generate.service';
import type { GenerateQuizInput } from './dto/quiz.dto';

// Trần an toàn khi coverAll (chống atom khổng lồ → timeout). Phần dư trả `remaining`.
const COVER_ALL_MAX_CHUNKS = 40;
// Số câu/chunk khi coverAll (phủ nội dung, không cap tổng).
const COVER_ALL_PER_CHUNK = 2;
// Số chunk gen song song mỗi batch (cân bằng tốc độ vs rate-limit LLM free).
const GEN_CONCURRENCY = 5;

/** Chuẩn hoá prompt để so trùng (dedup theo nội dung câu). */
function normPrompt(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Shape question trả client — khớp row Drizzle cũ (camelCase, thứ tự cột schema). */
export interface QuestionDto {
  id: string;
  quizId: string;
  type: string;
  prompt: string;
  options: unknown;
  correctAnswer: unknown;
  explanation: string;
  conceptId: string | null;
  difficulty: number;
}

@Injectable()
export class QuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: QuizGenerateService,
  ) {}

  /** Map row Prisma → shape quiz Drizzle cũ (thứ tự cột: id..createdAt). */
  private toQuizDto(row: QuizRow) {
    return {
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      title: row.title,
      config: row.config,
      createdAt: row.created_at,
    };
  }

  private toQuestionDto(row: QuestionRow): QuestionDto {
    return {
      id: row.id,
      quizId: row.quiz_id,
      type: row.type,
      prompt: row.prompt,
      options: row.options,
      correctAnswer: row.correct_answer,
      explanation: row.explanation,
      conceptId: row.concept_id,
      difficulty: row.difficulty,
    };
  }

  /**
   * GET /quiz — list quizzes kèm count questions. $queryRaw copy nguyên
   * LEFT JOIN COUNT của Drizzle cũ (count(question.id)::int tránh BigInt).
   */
  async listQuizzes(userId: string, limit: number, offset: number, workspaceParam: string | null) {
    const filters = [Prisma.sql`q.user_id = ${userId}`];
    if (workspaceParam === 'null') {
      filters.push(Prisma.sql`q.workspace_id IS NULL`);
    } else if (workspaceParam) {
      filters.push(Prisma.sql`q.workspace_id = ${workspaceParam}`);
    }

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        workspaceId: string | null;
        config: unknown;
        createdAt: Date;
        questionCount: number;
      }>
    >(Prisma.sql`
      SELECT q.id, q.title, q.workspace_id AS "workspaceId", q.config,
             q.created_at AS "createdAt",
             coalesce(count(qu.id), 0)::int AS "questionCount"
      FROM quiz q
      LEFT JOIN question qu ON qu.quiz_id = q.id
      WHERE ${Prisma.join(filters, ' AND ')}
      GROUP BY q.id
      ORDER BY q.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`);

    return { quizzes: rows };
  }

  /**
   * GET /quiz/:id — quiz + questions. withAnswers=false ẩn correctAnswer +
   * explanation (đang làm bài, tránh client lộ đáp án).
   */
  async getQuiz(userId: string, id: string, withAnswers: boolean) {
    const row = await this.prisma.quiz.findFirst({ where: { id, user_id: userId } });
    if (!row) throw new NotFoundException({ error: 'Not found' });

    const questions = await this.prisma.question.findMany({ where: { quiz_id: id } });

    const payload = withAnswers
      ? questions.map((q) => this.toQuestionDto(q))
      : questions.map((q) => ({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          conceptId: q.concept_id,
          difficulty: q.difficulty,
        }));

    return { quiz: this.toQuizDto(row), questions: payload };
  }

  /** DELETE /quiz/:id — DELETE..RETURNING như route cũ (atomic, lấy workspaceId để bust). */
  async deleteQuiz(userId: string, id: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; workspace_id: string | null }>>(
      Prisma.sql`DELETE FROM quiz WHERE id = ${id} AND user_id = ${userId} RETURNING id, workspace_id`,
    );
    if (rows.length === 0) throw new NotFoundException({ error: 'Not found' });

    // Quiz bị xoá đổi count quizzes của workspace → bust workspaceStats/atoms.
    const deletedWorkspaceId = rows[0]?.workspace_id;
    if (deletedWorkspaceId) {
      await onWorkspaceContentChanged(userId, deletedWorkspaceId);
    }
    return { deleted: true };
  }

  /**
   * POST /quiz/generate — AI sinh quiz từ document/chunks/atom.
   *
   * Logic port nguyên từ route cũ:
   *   1. Resolve chunks scope-by-user (conceptId → chunks của atom).
   *   2. Concept đại diện mỗi chunk (row đầu chunk_concept) → question.conceptId
   *      phục vụ BKT update sau attempt.
   *   3. Gen SONG SONG theo batch — coverAll phủ HẾT chunk atom (không cap
   *      `count`), ngược lại rải `count` đều + dừng sớm khi đủ.
   *   4. Dedup theo conceptId: bỏ câu prompt trùng câu đã có của atom.
   *   5. INSERT quiz + questions (inherit workspaceId từ doc nguồn).
   * Best-effort: chunk gen fail → skip, tổng câu có thể < dự kiến.
   */
  async generateQuiz(
    user: { id: string; plan?: string | null },
    input: GenerateQuizInput,
  ) {
    const { documentId, chunkIds, conceptId, types, count, coverAll, title } = input;
    if (!documentId && !conceptId && (!chunkIds || chunkIds.length === 0)) {
      throw new BadRequestException({ error: 'Cần cung cấp documentId, conceptId hoặc chunkIds' });
    }

    // ATOM-TARGETED: resolve chunks của atom (concept) thuộc tài liệu của user.
    let atomChunkIds: string[] | null = null;
    if (conceptId) {
      const rows = await this.prisma.chunk_concept.findMany({
        where: { concept_id: conceptId, chunk: { document: { user_id: user.id } } },
        select: { chunk_id: true },
      });
      atomChunkIds = rows.map((r) => r.chunk_id);
    }

    // Resolve chunks + workspaceId từ doc nguồn — quiz inherit workspace.
    const chunkRows = await this.prisma.chunk.findMany({
      where: {
        document: { user_id: user.id },
        ...(conceptId
          ? { id: { in: atomChunkIds ?? [] } }
          : documentId
            ? { document_id: documentId }
            : { id: { in: chunkIds ?? [] } }),
      },
      select: {
        id: true,
        content: true,
        document_id: true,
        document: { select: { workspace_id: true } },
      },
      take: 50, // upper bound để tránh sinh quá nhiều
    });
    const chunks = chunkRows.map((c) => ({
      id: c.id,
      content: c.content,
      workspaceId: c.document.workspace_id,
    }));

    if (chunks.length === 0) {
      throw new NotFoundException({ error: 'Không có chunks phù hợp' });
    }

    // coverAll → phủ hết chunk của atom (tới trần); ngược lại dùng toàn bộ chunk
    // đã lấy (≤50) rồi cap theo `count` ở vòng gen.
    const targetChunks = coverAll ? chunks.slice(0, COVER_ALL_MAX_CHUNKS) : chunks;
    const remaining = coverAll ? chunks.length - targetChunks.length : 0;
    // Số câu/chunk: coverAll cố định; ngược lại rải `count` đều, ≥1.
    const perChunk = coverAll
      ? COVER_ALL_PER_CHUNK
      : Math.max(1, Math.ceil(count / targetChunks.length));

    // Concept đại diện mỗi chunk — row đầu tiên thắng (như Drizzle cũ, không orderBy).
    const chunkIdList = targetChunks.map((c) => c.id);
    const chunkConceptRows = await this.prisma.chunk_concept.findMany({
      where: { chunk_id: { in: chunkIdList } },
      select: { chunk_id: true, concept_id: true },
    });
    const chunkToConcept = new Map<string, string>();
    for (const row of chunkConceptRows) {
      if (!chunkToConcept.has(row.chunk_id)) chunkToConcept.set(row.chunk_id, row.concept_id);
    }

    // Sinh questions SONG SONG theo batch (chống timeout khi coverAll phủ nhiều chunk).
    const genCtx = { userId: user.id, plan: (user.plan ?? 'FREE') as Plan };
    const generated: Array<GeneratedQuestion & { chunkId: string }> = [];
    for (let i = 0; i < targetChunks.length; i += GEN_CONCURRENCY) {
      // Non-coverAll: dừng sớm khi đã đủ `count` (tiết kiệm LLM call).
      if (!coverAll && generated.length >= count) break;
      const batch = targetChunks.slice(i, i + GEN_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (ch) => ({
          ch,
          qs: await this.generator.generateQuestions(ch.content, types, perChunk, genCtx),
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
      const existingQ = await this.prisma.question.findMany({
        where: { concept_id: conceptId },
        select: { prompt: true },
      });
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
      return { quiz: null, questions: [], remaining };
    }
    const finalQuestions = deduped;

    // INSERT quiz + questions. Quiz inherit workspaceId từ doc đầu tiên trong
    // chunks (giả thiết các chunk cùng doc; nếu mix doc → lấy doc đầu).
    const inheritedWorkspaceId = chunks[0]?.workspaceId ?? null;
    const insertedQuiz = await this.prisma.quiz.create({
      data: {
        // Route cũ để Drizzle $defaultFn sinh cuid2; api dùng randomUUID
        // (convention sẵn) — đều là text id opaque.
        id: randomUUID(),
        user_id: user.id,
        workspace_id: inheritedWorkspaceId,
        title:
          title ??
          `Quiz ${new Date().toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}`,
        config: { types, questionCount: finalQuestions.length },
      },
    });
    if (!insertedQuiz) {
      throw new InternalServerErrorException({ error: 'Tạo quiz thất bại' });
    }

    // Sinh id app-side để trả questions đúng THỨ TỰ insert (createMany không
    // có returning) — shape khớp .returning() Drizzle cũ.
    const insertedQuestions: QuestionDto[] = finalQuestions.map((q) => ({
      id: randomUUID(),
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
    }));
    await this.prisma.question.createMany({
      data: insertedQuestions.map((q) => ({
        id: q.id,
        quiz_id: q.quizId,
        type: q.type as 'MCQ' | 'TRUE_FALSE' | 'SHORT',
        prompt: q.prompt,
        options: q.options === null ? Prisma.DbNull : (q.options as Prisma.InputJsonValue),
        correct_answer: q.correctAnswer as Prisma.InputJsonValue,
        explanation: q.explanation,
        concept_id: q.conceptId,
        difficulty: q.difficulty,
      })),
    });

    // Quiz mới đổi badge stats workspace (count quizzes) → bust workspaceStats/atoms.
    // Chỉ bust khi inherit được workspace cụ thể.
    if (inheritedWorkspaceId) {
      await onWorkspaceContentChanged(user.id, inheritedWorkspaceId);
    }
    // Atom-targeted → quiz count của atom đổi → bust atom-view preview.
    if (conceptId) await onAtomChanged(user.id, conceptId);

    return {
      quiz: this.toQuizDto(insertedQuiz),
      questions: insertedQuestions,
      remaining,
    };
  }
}
