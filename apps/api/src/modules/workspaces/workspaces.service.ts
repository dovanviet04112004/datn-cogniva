/**
 * WorkspacesService — CRUD workspace + stats/atoms/manage/quick-quiz/
 * conversations. Port từ apps/web/src/app/api/workspaces/** — GIỮ NGUYÊN
 * wire shape (camelCase như Drizzle alias cũ, kể cả message lỗi tiếng Việt),
 * CÙNG cache key (ck.workspaces / workspaceStats / workspaceAtoms) +
 * invalidator onWorkspaceChanged để Next/Nest sống chung không lệch cache.
 *
 * Route cũ đọc list/stats/atoms qua dbReplica; api hiện chỉ có 1 PrismaClient
 * (primary) — chấp nhận trong giai đoạn strangler-fig (như search.service.ts).
 */
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type workspace as WorkspaceRow } from '@prisma/client';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { onWorkspaceChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from './dto/workspaces.dto';

/** Shape workspace trả client — khớp row Drizzle cũ (thứ tự cột schema). */
interface WorkspaceDto {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

/** 1 atom trong GET :id/atoms — Date đã ISO string ngay trong cache payload (như route cũ). */
interface WorkspaceAtomDto {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  difficulty: number | null;
  previewQuestion: string | null;
  previewAnswer: string | null;
  masteryScore: number | null;
  masteryAttempts: number;
  lastSeenAt: string | null;
  lastFlashcardAt: string | null;
  lastQuizAt: string | null;
  flashcardCount: number;
  questionCount: number;
  examQuestionCount: number;
}

export type AtomSort = 'mastery' | 'name' | 'difficulty';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  private toWorkspaceDto(row: WorkspaceRow): WorkspaceDto {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
    };
  }

  /** Verify workspace thuộc user (chống IDOR) — route cũ nào cũng check trước. */
  async assertOwned(userId: string, workspaceId: string): Promise<void> {
    const ws = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, user_id: userId },
      select: { id: true },
    });
    if (!ws) throw new NotFoundException({ error: 'Not found' });
  }

  /**
   * GET /workspaces — sidebar list kèm documentCount, cache-aside per-user
   * TTL 120s (cùng key route cũ; POST/PATCH/DELETE bust qua onWorkspaceChanged).
   */
  async listWorkspaces(userId: string) {
    const rows = await cached(ck.workspaces(userId), 120, () =>
      this.prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          description: string | null;
          createdAt: Date;
          documentCount: number;
        }>
      >(Prisma.sql`
        SELECT w.id, w.name, w.description, w.created_at AS "createdAt",
               COALESCE(dc.n, 0)::int AS "documentCount"
        FROM workspace w
        LEFT JOIN (
          SELECT workspace_id, COUNT(id) AS n
          FROM document
          WHERE user_id = ${userId}
          GROUP BY workspace_id
        ) dc ON dc.workspace_id = w.id
        WHERE w.user_id = ${userId}
        ORDER BY w.created_at ASC`),
    );
    return { workspaces: rows };
  }

  /** POST /workspaces — tạo + bust sidebar cache (tạo-rồi-thấy-ngay). */
  async createWorkspace(userId: string, input: CreateWorkspaceInput) {
    const inserted = await this.prisma.workspace.create({
      data: {
        // Route cũ để Drizzle $defaultFn sinh cuid2; api dùng randomUUID
        // (convention sẵn) — đều là text id opaque.
        id: randomUUID(),
        user_id: userId,
        name: input.name,
        description: input.description ?? null,
      },
    });

    await onWorkspaceChanged(userId);
    return { workspace: this.toWorkspaceDto(inserted) };
  }

  /** GET /workspaces/:id — meta + documents kèm chunkCount/pageCount. */
  async getWorkspace(userId: string, id: string) {
    const ws = await this.prisma.workspace.findFirst({ where: { id, user_id: userId } });
    if (!ws) throw new NotFoundException({ error: 'Not found' });

    // Route cũ chỉ filter document theo workspaceId (không thêm userId) — giữ nguyên.
    const docs = await this.prisma.$queryRaw<
      Array<{
        id: string;
        filename: string;
        mimeType: string;
        size: number;
        status: string;
        createdAt: Date;
        pageCount: number | null;
        chunks: number;
      }>
    >(Prisma.sql`
      SELECT d.id, d.filename, d.mime_type AS "mimeType", d.size, d.status::text AS status,
             d.created_at AS "createdAt",
             (d.metadata->>'pageCount')::int AS "pageCount",
             COALESCE(cc.n, 0)::int AS chunks
      FROM document d
      LEFT JOIN (
        SELECT document_id, COUNT(id) AS n
        FROM chunk
        GROUP BY document_id
      ) cc ON cc.document_id = d.id
      WHERE d.workspace_id = ${id}
      ORDER BY d.created_at DESC`);

    return { workspace: this.toWorkspaceDto(ws), documents: docs };
  }

  /** PATCH /workspaces/:id — rename/đổi mô tả, bust sidebar cache sau update. */
  async updateWorkspace(userId: string, id: string, input: UpdateWorkspaceInput) {
    const existing = await this.prisma.workspace.findFirst({ where: { id, user_id: userId } });
    if (!existing) throw new NotFoundException({ error: 'Not found' });

    const data: Prisma.workspaceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;

    const updated = await this.prisma.workspace.update({ where: { id }, data });

    await onWorkspaceChanged(userId);
    return { workspace: this.toWorkspaceDto(updated) };
  }

  /** DELETE /workspaces/:id — giữ tối thiểu 1 workspace (FK document NOT NULL). */
  async deleteWorkspace(userId: string, id: string) {
    const all = await this.prisma.workspace.findMany({
      where: { user_id: userId },
      select: { id: true },
    });
    if (all.length <= 1) {
      throw new BadRequestException({ error: 'Phải giữ ít nhất 1 workspace' });
    }

    const result = await this.prisma.workspace.deleteMany({ where: { id, user_id: userId } });
    if (result.count === 0) throw new NotFoundException({ error: 'Not found' });

    await onWorkspaceChanged(userId);
    return { deleted: true };
  }

  /**
   * GET /workspaces/:id/stats — 6 COUNT badge, cache-aside TTL 30s cùng key
   * route cũ (bust qua onWorkspaceContentChanged ở các route ghi content).
   */
  async getStats(userId: string, id: string) {
    await this.assertOwned(userId, id);

    const stats = await cached(ck.workspaceStats(userId, id), 30, async () => {
      const [documents, notes, flashcards, quizzes, exams, chats] = await Promise.all([
        this.prisma.document.count({ where: { user_id: userId, workspace_id: id } }),
        this.prisma.note.count({ where: { user_id: userId, workspace_id: id } }),
        this.prisma.flashcard.count({ where: { user_id: userId, workspace_id: id } }),
        this.prisma.quiz.count({ where: { user_id: userId, workspace_id: id } }),
        this.prisma.exam.count({ where: { owner_id: userId, workspace_id: id } }),
        this.prisma.conversation.count({ where: { user_id: userId, workspace_id: id } }),
      ]);
      return { documents, notes, flashcards, quizzes, exams, chats };
    });

    return { stats };
  }

  /** GET /workspaces/:id/conversations — switcher dropdown ChatView (limit 50). */
  async listConversations(userId: string, workspaceId: string) {
    await this.assertOwned(userId, workspaceId);

    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; title: string | null; createdAt: Date; lastMessageAt: Date | null; messageCount: number }>
    >(Prisma.sql`
      SELECT c.id, c.title, c.created_at AS "createdAt",
        (SELECT MAX(m.created_at) FROM message m WHERE m.conversation_id = c.id) AS "lastMessageAt",
        (SELECT COUNT(*)::int FROM message m WHERE m.conversation_id = c.id) AS "messageCount"
      FROM conversation c
      WHERE c.user_id = ${userId} AND c.workspace_id = ${workspaceId}
      ORDER BY c.created_at DESC
      LIMIT 50`);

    return {
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.createdAt.toISOString(),
        lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
        messageCount: r.messageCount,
      })),
    };
  }

  /**
   * GET /workspaces/:id/atoms — list atom đầy đủ cache-aside TTL 60s (key
   * KHÔNG fold sort/limit — sort + slice ngoài cache như route cũ để giữ
   * hit-rate; payload đã ISO string nên cache hit/miss serialize y nhau).
   */
  async listAtoms(userId: string, workspaceId: string, sort: AtomSort, limit: number) {
    await this.assertOwned(userId, workspaceId);

    const atoms = await cached(ck.workspaceAtoms(userId, workspaceId), 60, () =>
      this.loadAtoms(userId, workspaceId),
    );

    // Sort theo query param (ngoài cache — in-memory, rẻ)
    atoms.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'difficulty') {
        const da = a.difficulty ?? 0.5;
        const db_ = b.difficulty ?? 0.5;
        return db_ - da; // khó trước
      }
      // 'mastery' (default): null trước (chưa biết), sau đó score ASC (yếu nhất)
      if (a.masteryScore === null && b.masteryScore !== null) return -1;
      if (a.masteryScore !== null && b.masteryScore === null) return 1;
      return (a.masteryScore ?? 0) - (b.masteryScore ?? 0);
    });

    return { atoms: atoms.slice(0, limit) };
  }

  private async loadAtoms(userId: string, workspaceId: string): Promise<WorkspaceAtomDto[]> {
    // Step 1: concept IDs link với chunk thuộc document của workspace
    const conceptIdRows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT cc.concept_id AS id
      FROM chunk_concept cc
      INNER JOIN chunk ch ON ch.id = cc.chunk_id
      INNER JOIN document d ON d.id = ch.document_id
      WHERE d.workspace_id = ${workspaceId} AND d.user_id = ${userId}`);
    const conceptIds = conceptIdRows.map((r) => r.id);
    if (conceptIds.length === 0) return [];

    // Step 2-4: concept rows + mastery (user-scoped) + 3 count GROUP BY
    const [concepts, masteryRows, fcCounts, qCounts, exCounts] = await Promise.all([
      this.prisma.concept.findMany({ where: { id: { in: conceptIds } } }),
      this.prisma.mastery.findMany({
        where: { user_id: userId, concept_id: { in: conceptIds } },
        select: {
          concept_id: true,
          score: true,
          attempts: true,
          last_seen_at: true,
          last_flashcard_at: true,
          last_quiz_at: true,
        },
      }),
      this.prisma.$queryRaw<Array<{ concept_id: string; n: number }>>(Prisma.sql`
        SELECT concept_id, COUNT(*)::int AS n
        FROM flashcard
        WHERE user_id = ${userId}
          AND workspace_id = ${workspaceId}
          AND concept_id IN (${Prisma.join(conceptIds)})
        GROUP BY concept_id`),
      this.prisma.$queryRaw<Array<{ concept_id: string; n: number }>>(Prisma.sql`
        SELECT concept_id, COUNT(*)::int AS n
        FROM question
        WHERE concept_id IN (${Prisma.join(conceptIds)})
        GROUP BY concept_id`),
      this.prisma.$queryRaw<Array<{ concept_id: string; n: number }>>(Prisma.sql`
        SELECT concept_id, COUNT(*)::int AS n
        FROM exam_question
        WHERE concept_id IN (${Prisma.join(conceptIds)})
        GROUP BY concept_id`),
    ]);

    const masteryMap = new Map(masteryRows.map((m) => [m.concept_id, m]));
    const fcMap = new Map(fcCounts.map((c) => [c.concept_id, c.n]));
    const qMap = new Map(qCounts.map((c) => [c.concept_id, c.n]));
    const exMap = new Map(exCounts.map((c) => [c.concept_id, c.n]));

    return concepts.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      domain: c.domain,
      difficulty: c.difficulty,
      previewQuestion: c.preview_question,
      previewAnswer: c.preview_answer,
      masteryScore: masteryMap.get(c.id)?.score ?? null,
      masteryAttempts: masteryMap.get(c.id)?.attempts ?? 0,
      // lastSeenAt = mốc hoạt động gần nhất (học/đánh dấu) → sort "mới nhất lên đầu".
      lastSeenAt: masteryMap.get(c.id)?.last_seen_at?.toISOString() ?? null,
      lastFlashcardAt: masteryMap.get(c.id)?.last_flashcard_at?.toISOString() ?? null,
      lastQuizAt: masteryMap.get(c.id)?.last_quiz_at?.toISOString() ?? null,
      flashcardCount: fcMap.get(c.id) ?? 0,
      questionCount: qMap.get(c.id) ?? 0,
      examQuestionCount: exMap.get(c.id) ?? 0,
    }));
  }

  /**
   * GET /workspaces/:id/manage — flashcard + câu hỏi quiz kèm cột "đã làm".
   * Đọc PRIMARY không cache (route cũ chủ đích read-your-own-write).
   */
  async manage(userId: string, workspaceId: string) {
    await this.assertOwned(userId, workspaceId);

    // ── Flashcards của workspace ────────────────────────────────────────────
    const fcRows = await this.prisma.flashcard.findMany({
      where: { user_id: userId, workspace_id: workspaceId },
      orderBy: { last_review: { sort: 'desc', nulls: 'last' } },
      select: {
        id: true,
        front: true,
        back: true,
        card_type: true,
        state: true,
        due: true,
        last_review: true,
        concept_id: true,
      },
    });

    // ── Quiz + câu hỏi của workspace ────────────────────────────────────────
    const quizzes = await this.prisma.quiz.findMany({
      where: { user_id: userId, workspace_id: workspaceId },
      select: { id: true, title: true },
    });
    const quizTitleById = new Map(quizzes.map((q) => [q.id, q.title]));
    const quizIds = quizzes.map((q) => q.id);

    const qRows =
      quizIds.length > 0
        ? await this.prisma.question.findMany({
            where: { quiz_id: { in: quizIds } },
            select: { id: true, prompt: true, type: true, concept_id: true, quiz_id: true },
          })
        : [];

    // "Đã làm" + đúng/sai gần nhất theo từng câu (quiz_response, lấy bản mới nhất).
    const qIds = qRows.map((q) => q.id);
    const answeredByQuestion = new Map<string, { isCorrect: boolean | null; answeredAt: Date | null }>();
    if (qIds.length > 0) {
      const responses = await this.prisma.quiz_response.findMany({
        where: { user_id: userId, question_id: { in: qIds } },
        orderBy: { answered_at: 'desc' },
        select: { question_id: true, is_correct: true, answered_at: true },
      });
      for (const r of responses) {
        // responses sort mới→cũ → bản đầu gặp mỗi câu là gần nhất.
        if (!answeredByQuestion.has(r.question_id)) {
          answeredByQuestion.set(r.question_id, { isCorrect: r.is_correct, answeredAt: r.answered_at });
        }
      }
    }

    // ── Tên atom (concept) cho cả 2 danh sách ───────────────────────────────
    const conceptIds = [
      ...new Set(
        [...fcRows.map((r) => r.concept_id), ...qRows.map((r) => r.concept_id)].filter(
          (c): c is string => c !== null,
        ),
      ),
    ];
    const conceptNameById = new Map<string, string>();
    if (conceptIds.length > 0) {
      const cRows = await this.prisma.concept.findMany({
        where: { id: { in: conceptIds } },
        select: { id: true, name: true },
      });
      for (const c of cRows) conceptNameById.set(c.id, c.name);
    }

    const flashcards = fcRows.map((f) => ({
      id: f.id,
      front: f.front,
      back: f.back,
      cardType: f.card_type,
      state: f.state,
      due: f.due?.toISOString() ?? null,
      lastReview: f.last_review?.toISOString() ?? null,
      atomName: f.concept_id ? (conceptNameById.get(f.concept_id) ?? null) : null,
      done: f.last_review !== null,
    }));

    const questions = qRows.map((q) => {
      const ans = answeredByQuestion.get(q.id);
      return {
        id: q.id,
        prompt: q.prompt,
        type: q.type,
        quizTitle: quizTitleById.get(q.quiz_id) ?? null,
        atomName: q.concept_id ? (conceptNameById.get(q.concept_id) ?? null) : null,
        done: ans !== undefined,
        lastCorrect: ans?.isCorrect ?? null,
        answeredAt: ans?.answeredAt?.toISOString() ?? null,
      };
    });

    return { flashcards, questions };
  }

  /**
   * GET /workspaces/:id/quick-quiz — 5 question random từ atom của workspace,
   * KHÔNG trả correctAnswer (client submit grade endpoint riêng).
   */
  async quickQuiz(userId: string, workspaceId: string) {
    await this.assertOwned(userId, workspaceId);

    const conceptRows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT cc.concept_id AS id
      FROM chunk_concept cc
      INNER JOIN chunk ch ON ch.id = cc.chunk_id
      INNER JOIN document d ON d.id = ch.document_id
      WHERE d.workspace_id = ${workspaceId} AND d.user_id = ${userId}`);

    const conceptIds = conceptRows.map((r) => r.id);
    if (conceptIds.length === 0) {
      return { questions: [], hint: 'no-atoms' };
    }

    const questions = await this.prisma.$queryRaw<
      Array<{
        id: string;
        prompt: string;
        type: string;
        options: unknown;
        conceptId: string | null;
        difficulty: number;
      }>
    >(Prisma.sql`
      SELECT id, prompt, type::text AS type, options, concept_id AS "conceptId", difficulty
      FROM question
      WHERE concept_id IN (${Prisma.join(conceptIds)})
      ORDER BY RANDOM()
      LIMIT 5`);

    if (questions.length === 0) {
      return { questions: [], hint: 'no-questions' };
    }

    return { questions };
  }
}
