import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { onExamChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import type { Plan } from '../../infra/ai/cost-guardrail.service';
import type { AuthUser } from '../../common/auth/session.types';
import { ExamAiService, type GeneratedQuestion, type QuestionType } from './exam-ai.service';
import { jsonOrDbNull, toExamDto, toQuestionDto } from './exam.mappers';
import {
  createQuestionSchema,
  generateQuestionsSchema,
  joinExamSchema,
  updateExamSchema,
  updateQuestionSchema,
  type CreateExamInput,
} from './dto/exams.dto';

type JoinedExamRow = {
  id: string;
  title: string;
  description: string | null;
  mode: string;
  status: string;
  durationSeconds: number | null;
  maxScore: number;
  maxAttempts: number;
  publishedAt: Date | null;
  ownerName: string | null;
  attemptCount: number;
  bestScore: number | null;
  bestPercentage: number | null;
  latestAttemptId: string | null;
  latestStatus: string | null;
  latestStartedAt: Date;
};

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function mapGeneratedType(t: QuestionType): string {
  if (t === 'MCQ') return 'MCQ_SINGLE';
  return t;
}

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: ExamAiService,
  ) {}

  async listExams(uid: string, workspaceParam: string | null) {
    const wsKey = workspaceParam ?? 'all';

    return cached(ck.exams(uid, wsKey), 120, async () => {
      const where: Prisma.examWhereInput = { owner_id: uid };
      if (workspaceParam === 'null') where.workspace_id = null;
      else if (workspaceParam) where.workspace_id = workspaceParam;

      const ownedRows = await this.prisma.exam.findMany({
        where,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          workspace_id: true,
          mode: true,
          status: true,
          duration_seconds: true,
          max_score: true,
          max_attempts: true,
          created_at: true,
          published_at: true,
        },
      });
      const owned = ownedRows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        workspaceId: r.workspace_id,
        mode: r.mode,
        status: r.status,
        durationSeconds: r.duration_seconds,
        maxScore: r.max_score,
        maxAttempts: r.max_attempts,
        createdAt: r.created_at,
        publishedAt: r.published_at,
      }));

      const joined = await this.prisma.$queryRaw<JoinedExamRow[]>(Prisma.sql`
        SELECT
          e.id,
          e.title,
          e.description,
          e.mode,
          e.status,
          e.duration_seconds AS "durationSeconds",
          e.max_score AS "maxScore",
          e.max_attempts AS "maxAttempts",
          e.published_at AS "publishedAt",
          u.name AS "ownerName",
          count(ea.id)::int AS "attemptCount",
          max(ea.score) AS "bestScore",
          max(ea.percentage) AS "bestPercentage",
          (array_agg(ea.id ORDER BY ea.started_at DESC))[1] AS "latestAttemptId",
          (array_agg(ea.status::text ORDER BY ea.started_at DESC))[1] AS "latestStatus",
          max(ea.started_at) AS "latestStartedAt"
        FROM exam_attempt ea
        INNER JOIN exam e ON ea.exam_id = e.id
        INNER JOIN "user" u ON e.owner_id = u.id
        WHERE ea.user_id = ${uid} AND e.owner_id <> ${uid}
        GROUP BY e.id, e.title, e.description, e.mode, e.status,
          e.duration_seconds, e.max_score, e.max_attempts, e.published_at, u.name
        ORDER BY max(ea.started_at) DESC`);

      return { owned, joined };
    });
  }

  async createExam(userId: string, input: CreateExamInput) {
    if (input.mode === 'TIMED' && !input.durationSeconds) {
      throw new BadRequestException({ error: 'TIMED mode bắt buộc có durationSeconds' });
    }

    const created = await this.prisma.exam.create({
      data: {
        id: randomUUID(),
        owner_id: userId,
        workspace_id: input.workspaceId ?? null,
        title: input.title,
        description: input.description ?? null,
        mode: input.mode,
        duration_seconds: input.durationSeconds ?? null,
        passing_score: input.passingScore ?? null,
        shuffle_questions: input.shuffleQuestions ?? true,
        shuffle_options: input.shuffleOptions ?? true,
        allow_review: input.allowReview ?? true,
        max_attempts: input.maxAttempts ?? 1,
        show_results: input.showResults ?? 'IMMEDIATE',
      },
    });

    await onExamChanged(userId, created.workspace_id);

    return { exam: toExamDto(created) };
  }

  async joinByCode(raw: unknown) {
    const parsed = joinExamSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Code không hợp lệ' });
    }
    const code = parsed.data.code.toUpperCase().trim();

    const row = await this.prisma.exam.findFirst({
      where: { live_code: code },
      select: { id: true, mode: true, status: true },
    });
    if (!row) {
      throw new NotFoundException({ error: 'Không tìm thấy exam với code này' });
    }
    if (row.status !== 'PUBLISHED') {
      throw new ForbiddenException({ error: `Exam chưa public (status: ${row.status})` });
    }

    return { examId: row.id, mode: row.mode };
  }

  async getExam(userId: string, id: string) {
    const row = await this.prisma.exam.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ error: 'Not found' });

    const isOwner = row.owner_id === userId;
    if (!isOwner && row.status === 'DRAFT') {
      throw new ForbiddenException({ error: 'Exam chưa publish' });
    }

    const questions = await this.prisma.exam_question.findMany({
      where: { exam_id: id },
      orderBy: { order_index: 'asc' },
    });

    const stripped = isOwner ? questions.map(toQuestionDto) : [];

    return {
      exam: toExamDto(row),
      questions: stripped,
      questionCount: questions.length,
      isOwner,
    };
  }

  async updateExam(userId: string, id: string, raw: unknown) {
    const row = await this.prisma.exam.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ error: 'Not found' });
    if (row.owner_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }
    if (row.status !== 'DRAFT') {
      throw new ConflictException({
        error: 'Chỉ exam DRAFT mới edit được. Hiện status: ' + row.status,
      });
    }

    const parsed = updateExamSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }
    const d = parsed.data;

    if (d.mode === 'TIMED') {
      const finalDuration = d.durationSeconds ?? row.duration_seconds;
      if (!finalDuration) {
        throw new BadRequestException({ error: 'TIMED mode bắt buộc có durationSeconds' });
      }
    }

    const data: Prisma.examUncheckedUpdateInput = {};
    if (d.title !== undefined) data.title = d.title;
    if (d.description !== undefined) data.description = d.description;
    if (d.mode !== undefined) data.mode = d.mode;
    if (d.durationSeconds !== undefined) data.duration_seconds = d.durationSeconds;
    if (d.startsAt !== undefined) data.starts_at = d.startsAt ? new Date(d.startsAt) : null;
    if (d.endsAt !== undefined) data.ends_at = d.endsAt ? new Date(d.endsAt) : null;
    if (d.passingScore !== undefined) data.passing_score = d.passingScore;
    if (d.shuffleQuestions !== undefined) data.shuffle_questions = d.shuffleQuestions;
    if (d.shuffleOptions !== undefined) data.shuffle_options = d.shuffleOptions;
    if (d.allowReview !== undefined) data.allow_review = d.allowReview;
    if (d.maxAttempts !== undefined) data.max_attempts = d.maxAttempts;
    if (d.showResults !== undefined) data.show_results = d.showResults;
    if (d.antiCheat !== undefined) data.anti_cheat = d.antiCheat;

    const updated = await this.prisma.exam.update({ where: { id }, data });

    await onExamChanged(updated.owner_id, updated.workspace_id);

    return { exam: toExamDto(updated) };
  }

  async deleteExam(userId: string, id: string) {
    const row = await this.prisma.exam.findUnique({
      where: { id },
      select: { owner_id: true, status: true, workspace_id: true },
    });
    if (!row) throw new NotFoundException({ error: 'Not found' });
    if (row.owner_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    await this.prisma.exam.deleteMany({ where: { id } });

    await onExamChanged(row.owner_id, row.workspace_id);

    return { ok: true };
  }

  async generateQuestions(user: AuthUser, id: string, raw: unknown) {
    const parent = await this.prisma.exam.findUnique({
      where: { id },
      select: { owner_id: true, status: true, workspace_id: true },
    });
    if (!parent) throw new NotFoundException({ error: 'Not found' });
    if (parent.owner_id !== user.id) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }
    if (parent.status !== 'DRAFT') {
      throw new ConflictException({ error: `Chỉ DRAFT mới gen câu hỏi. Hiện: ${parent.status}` });
    }

    const parsed = generateQuestionsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }
    const { documentId, chunkIds, types, count } = parsed.data;
    if (!documentId && (!chunkIds || chunkIds.length === 0)) {
      throw new BadRequestException({ error: 'Cần documentId hoặc chunkIds' });
    }

    const chunks = await this.prisma.chunk.findMany({
      where: {
        document: { user_id: user.id },
        ...(documentId ? { document_id: documentId } : { id: { in: chunkIds ?? [] } }),
      },
      select: { id: true, content: true },
      take: 50,
    });

    if (chunks.length === 0) {
      throw new NotFoundException({ error: 'Không có chunks phù hợp' });
    }

    const perChunk = Math.max(1, Math.ceil(count / chunks.length));

    const chunkConceptRows = await this.prisma.chunk_concept.findMany({
      where: { chunk_id: { in: chunks.map((c) => c.id) } },
      select: { chunk_id: true, concept_id: true },
    });
    const chunkToConcept = new Map<string, string>();
    for (const row of chunkConceptRows) {
      if (!chunkToConcept.has(row.chunk_id)) chunkToConcept.set(row.chunk_id, row.concept_id);
    }

    const plan = (user.plan ?? 'FREE') as Plan;
    const genCtx = { userId: user.id, plan };
    const generated: Array<GeneratedQuestion & { chunkId: string }> = [];
    for (const ch of chunks) {
      if (generated.length >= count) break;
      const qs = await this.ai.generateQuestions(
        ch.content,
        types as QuestionType[],
        perChunk,
        genCtx,
      );
      for (const q of qs) {
        generated.push({ ...q, chunkId: ch.id });
        if (generated.length >= count) break;
      }
    }

    if (generated.length === 0) {
      throw new InternalServerErrorException({ error: 'AI không sinh được câu hỏi' });
    }

    const [maxOrder] = await this.prisma.$queryRaw<Array<{ max: number }>>(Prisma.sql`
      SELECT coalesce(max(order_index), -1)::int AS max
      FROM exam_question WHERE exam_id = ${id}`);
    let nextIndex = (maxOrder?.max ?? -1) + 1;

    const inserted = await this.prisma.exam_question.createManyAndReturn({
      data: generated.map((q) => ({
        id: randomUUID(),
        exam_id: id,
        type: mapGeneratedType(q.type),
        prompt: q.prompt,
        options: q.type === 'MCQ' ? (q.options as Prisma.InputJsonValue) : Prisma.DbNull,
        correct_answer: q.correctAnswer as Prisma.InputJsonValue,
        explanation: q.explanation,
        concept_id: chunkToConcept.get(q.chunkId) ?? null,
        difficulty: q.difficulty,
        points: 1,
        order_index: nextIndex++,
      })),
    });

    await onExamChanged(parent.owner_id, parent.workspace_id);
    return { questions: inserted.map(toQuestionDto), count: inserted.length };
  }

  async getProctor(userId: string, id: string) {
    const parent = await this.prisma.exam.findUnique({ where: { id } });
    if (!parent) throw new NotFoundException({ error: 'Not found' });
    if (parent.owner_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT
        ea.id,
        ea.user_id AS "userId",
        u.name AS "userName",
        ea.status,
        ea.started_at AS "startedAt",
        ea.submitted_at AS "submittedAt",
        ea.score,
        ea.cheat_risk_score AS "cheatRiskScore",
        ea.flagged,
        ea.flag_reason AS "flagReason",
        (SELECT COUNT(*)::int FROM exam_violation ev WHERE ev.attempt_id = ea.id) AS "violationCount"
      FROM exam_attempt ea
      INNER JOIN "user" u ON ea.user_id = u.id
      WHERE ea.exam_id = ${id}
      ORDER BY ea.flagged DESC, ea.cheat_risk_score DESC`);

    return { attempts: rows };
  }

  async publishExam(userId: string, id: string) {
    const row = await this.prisma.exam.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ error: 'Not found' });
    if (row.owner_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }
    if (row.status !== 'DRAFT') {
      throw new ConflictException({ error: `Chỉ DRAFT mới publish được. Hiện: ${row.status}` });
    }

    const [agg] = await this.prisma.$queryRaw<Array<{ count: number; total: number }>>(Prisma.sql`
      SELECT count(*)::int AS count, coalesce(sum(points), 0)::real AS total
      FROM exam_question WHERE exam_id = ${id}`);

    if (!agg || agg.count === 0) {
      throw new ConflictException({ error: 'Exam chưa có câu hỏi nào — thêm trước khi publish' });
    }

    const needsCode = !row.live_code;

    const published = await this.prisma.exam.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        published_at: new Date(),
        max_score: agg.total,
        ...(needsCode ? { live_code: generateJoinCode() } : {}),
      },
    });

    return { exam: toExamDto(published) };
  }

  async addQuestion(userId: string, examId: string, raw: unknown) {
    const parent = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: { owner_id: true, status: true },
    });
    if (!parent) throw new NotFoundException({ error: 'Not found' });
    if (parent.owner_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }
    if (parent.status !== 'DRAFT') {
      throw new ConflictException({
        error: `Chỉ DRAFT exam mới thêm câu hỏi. Hiện: ${parent.status}`,
      });
    }

    const parsed = createQuestionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }
    const d = parsed.data;

    const [maxOrder] = await this.prisma.$queryRaw<Array<{ max: number }>>(Prisma.sql`
      SELECT coalesce(max(order_index), -1)::int AS max
      FROM exam_question WHERE exam_id = ${examId}`);
    const nextIndex = (maxOrder?.max ?? -1) + 1;

    const created = await this.prisma.exam_question.create({
      data: {
        id: randomUUID(),
        exam_id: examId,
        type: d.type,
        prompt: d.prompt,
        prompt_html: d.promptHtml ?? null,
        attachments: jsonOrDbNull(d.attachments),
        options: jsonOrDbNull(d.options),
        correct_answer: jsonOrDbNull(d.correctAnswer),
        acceptable_answers: jsonOrDbNull(d.acceptableAnswers),
        rubric: jsonOrDbNull(d.rubric),
        points: d.points,
        partial_credit: d.partialCredit ?? false,
        concept_id: d.conceptId ?? null,
        explanation: d.explanation ?? null,
        hint: d.hint ?? null,
        time_limit_seconds: d.timeLimitSeconds ?? null,
        order_index: nextIndex,
      },
    });

    return { question: toQuestionDto(created) };
  }

  private async checkOwnerDraft(examId: string, userId: string): Promise<void> {
    const parent = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: { owner_id: true, status: true },
    });
    if (!parent) throw new NotFoundException({ error: 'Exam not found' });
    if (parent.owner_id !== userId) throw new ForbiddenException({ error: 'Forbidden' });
    if (parent.status !== 'DRAFT') {
      throw new ConflictException({ error: `Chỉ DRAFT mới edit được. Hiện: ${parent.status}` });
    }
  }

  async updateQuestion(userId: string, examId: string, qId: string, raw: unknown) {
    await this.checkOwnerDraft(examId, userId);

    const parsed = updateQuestionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }
    const d = parsed.data;

    const existing = await this.prisma.exam_question.findFirst({
      where: { id: qId, exam_id: examId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException({ error: 'Question not found' });

    const data: Prisma.exam_questionUncheckedUpdateInput = {};
    if (d.prompt !== undefined) data.prompt = d.prompt;
    if (d.promptHtml !== undefined) data.prompt_html = d.promptHtml;
    if (d.options !== undefined) data.options = jsonOrDbNull(d.options);
    if (d.correctAnswer !== undefined) data.correct_answer = jsonOrDbNull(d.correctAnswer);
    if (d.acceptableAnswers !== undefined)
      data.acceptable_answers = jsonOrDbNull(d.acceptableAnswers);
    if (d.rubric !== undefined) data.rubric = jsonOrDbNull(d.rubric);
    if (d.points !== undefined) data.points = d.points;
    if (d.partialCredit !== undefined) data.partial_credit = d.partialCredit;
    if (d.explanation !== undefined) data.explanation = d.explanation;
    if (d.hint !== undefined) data.hint = d.hint;
    if (d.timeLimitSeconds !== undefined) data.time_limit_seconds = d.timeLimitSeconds;
    if (d.orderIndex !== undefined) data.order_index = d.orderIndex;

    const updated = await this.prisma.exam_question.update({ where: { id: qId }, data });
    return { question: toQuestionDto(updated) };
  }

  async deleteQuestion(userId: string, examId: string, qId: string) {
    await this.checkOwnerDraft(examId, userId);

    const removed = await this.prisma.$queryRaw<Array<{ order_index: number }>>(Prisma.sql`
      DELETE FROM exam_question WHERE id = ${qId} AND exam_id = ${examId}
      RETURNING order_index`);

    if (removed.length === 0) throw new NotFoundException({ error: 'Question not found' });

    await this.prisma.exam_question.updateMany({
      where: { exam_id: examId, order_index: { gt: removed[0]!.order_index } },
      data: { order_index: { decrement: 1 } },
    });

    return { ok: true };
  }
}
