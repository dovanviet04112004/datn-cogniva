import { randomUUID } from 'node:crypto';
import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type flashcard as FlashcardRow } from '@prisma/client';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { onAtomChanged, onFlashcardChanged } from '@cogniva/server-core/cache/invalidate';

import type { Plan } from '../../infra/ai/cost-guardrail.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { XP_AMOUNTS, XpService } from '../gamification/xp.service';
import { MasteryUpdateService } from '../learning/mastery-update.service';
import {
  FlashcardGenService,
  type GeneratedCard,
  type GenerateContext,
} from './flashcard-gen.service';
import { applyReview, initFsrsFields } from './fsrs';
import type {
  CreateFlashcardInput,
  GenerateFlashcardsInput,
  ReviewFlashcardInput,
} from './dto/flashcards.dto';

interface FlashcardDto {
  id: string;
  userId: string;
  workspaceId: string | null;
  conceptId: string | null;
  front: string;
  back: string;
  cardType: FlashcardRow['card_type'];
  sourceChunkId: string | null;
  difficulty: number;
  stability: number;
  retrievability: number;
  state: FlashcardRow['state'];
  due: Date;
  lastReview: Date | null;
}

const STATES = ['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'] as const;

const COVER_ALL_MAX = 40;
const GEN_CONCURRENCY = 5;

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

export interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class FlashcardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly xp: XpService,
    private readonly masteryUpdate: MasteryUpdateService,
    private readonly gen: FlashcardGenService,
  ) {}

  private toDto(row: FlashcardRow): FlashcardDto {
    return {
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      conceptId: row.concept_id,
      front: row.front,
      back: row.back,
      cardType: row.card_type,
      sourceChunkId: row.source_chunk_id,
      difficulty: row.difficulty,
      stability: row.stability,
      retrievability: row.retrievability,
      state: row.state,
      due: row.due,
      lastReview: row.last_review,
    };
  }

  async list(
    userId: string,
    opts: { state: string | null; workspaceParam: string | null; limit: number; offset: number },
  ) {
    const where: Prisma.flashcardWhereInput = { user_id: userId };
    if (opts.state && (STATES as readonly string[]).includes(opts.state)) {
      where.state = opts.state as (typeof STATES)[number];
    }
    if (opts.workspaceParam === 'null') where.workspace_id = null;
    else if (opts.workspaceParam) where.workspace_id = opts.workspaceParam;

    const rows = await this.prisma.flashcard.findMany({
      where,
      orderBy: { due: 'desc' },
      take: opts.limit,
      skip: opts.offset,
    });
    return { flashcards: rows.map((r) => this.toDto(r)) };
  }

  async create(userId: string, input: CreateFlashcardInput) {
    const fsrs = initFsrsFields();
    const inserted = await this.prisma.flashcard.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        workspace_id: input.workspaceId ?? null,
        concept_id: input.conceptId ?? null,
        source_chunk_id: input.sourceChunkId ?? null,
        front: input.front,
        back: input.back,
        card_type: input.cardType,
        difficulty: fsrs.difficulty,
        stability: fsrs.stability,
        retrievability: fsrs.retrievability,
        state: fsrs.state,
        due: fsrs.due,
        last_review: fsrs.lastReview,
      },
    });

    await onFlashcardChanged(userId, inserted.workspace_id);
    return { flashcard: this.toDto(inserted) };
  }

  async get(userId: string, id: string) {
    const row = await this.prisma.flashcard.findFirst({ where: { id, user_id: userId } });
    if (!row) throw new NotFoundException({ error: 'Not found' });
    return { flashcard: this.toDto(row) };
  }

  async remove(userId: string, id: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; workspace_id: string | null }>>(
      Prisma.sql`DELETE FROM flashcard WHERE id = ${id} AND user_id = ${userId} RETURNING id, workspace_id`,
    );
    if (rows.length === 0) throw new NotFoundException({ error: 'Not found' });

    await onFlashcardChanged(userId, rows[0]?.workspace_id);
    return { ok: true };
  }

  async review(userId: string, id: string, input: ReviewFlashcardInput) {
    const card = await this.prisma.flashcard.findFirst({ where: { id, user_id: userId } });
    if (!card) throw new NotFoundException({ error: 'Not found' });

    const next = applyReview(
      {
        difficulty: card.difficulty,
        stability: card.stability,
        retrievability: card.retrievability,
        state: card.state,
        due: card.due,
        lastReview: card.last_review,
      },
      input.rating,
    );

    await this.prisma.flashcard.update({
      where: { id },
      data: {
        difficulty: next.difficulty,
        stability: next.stability,
        retrievability: next.retrievability,
        state: next.state,
        due: next.due,
        last_review: next.lastReview,
      },
    });
    await this.prisma.review.create({
      data: { id: randomUUID(), flashcard_id: id, rating: input.rating, duration: input.duration },
    });

    await onFlashcardChanged(userId, card.workspace_id);

    if (card.concept_id) {
      const obsScore = [0, 0.0, 0.4, 0.8, 1.0][input.rating] ?? 0;
      try {
        await this.masteryUpdate.applyAttempt(
          userId,
          card.concept_id,
          obsScore,
          'flashcard',
          card.workspace_id,
        );
      } catch (err) {
        console.warn('[flashcard-review] applyAttempt failed:', err);
      }
    }

    const xpAmount =
      input.rating >= 3 ? XP_AMOUNTS.FLASHCARD_REVIEW_PASS : XP_AMOUNTS.FLASHCARD_REVIEW_FAIL;
    const { newAchievements } = await this.xp.awardXp(userId, xpAmount, {
      source: 'flashcard',
      totalCount: 1,
    });

    return {
      flashcard: { ...this.toDto(card), ...next },
      xp: { awarded: xpAmount, newAchievements },
    };
  }

  async queue(userId: string, limit: number, workspaceId: string | null) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT id, user_id, concept_id, front, back, card_type, source_chunk_id,
             difficulty, stability, retrievability, state,
             due::text AS due, last_review::text AS last_review, workspace_id
      FROM flashcard
      WHERE user_id = ${userId}
        AND due <= NOW()
        ${workspaceId ? Prisma.sql`AND workspace_id = ${workspaceId}` : Prisma.empty}
      ORDER BY
        CASE state
          WHEN 'NEW' THEN 1
          WHEN 'RELEARNING' THEN 2
          WHEN 'LEARNING' THEN 3
          WHEN 'REVIEW' THEN 4
        END,
        due ASC
      LIMIT ${limit};
    `);
    return { flashcards: rows };
  }

  async stats(userId: string) {
    return cached(ck.flashcardStats(userId), 60, async () => {
      const stateRows = await this.prisma.$queryRaw<Array<{ state: string; n: number }>>(Prisma.sql`
        SELECT state, count(*)::int AS n
        FROM flashcard
        WHERE user_id = ${userId}
        GROUP BY state;
      `);
      const byState: Record<string, number> = { NEW: 0, LEARNING: 0, REVIEW: 0, RELEARNING: 0 };
      stateRows.forEach((r) => {
        byState[r.state] = r.n;
      });

      const [dueRow] = await this.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT count(*)::int AS n
        FROM flashcard
        WHERE user_id = ${userId} AND due <= NOW() + INTERVAL '1 day';
      `);

      const [reviewStat] = await this.prisma.$queryRaw<
        Array<{ total: number; good: number }>
      >(Prisma.sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE rating >= 3)::int AS good
        FROM review r
        INNER JOIN flashcard f ON f.id = r.flashcard_id
        WHERE f.user_id = ${userId}
          AND r.created_at >= NOW() - INTERVAL '7 days';
      `);

      const totalReviews = reviewStat?.total ?? 0;
      const retentionRate = totalReviews > 0 ? (reviewStat?.good ?? 0) / totalReviews : 0;

      return {
        byState,
        dueToday: dueRow?.n ?? 0,
        reviewsLast7d: totalReviews,
        retentionRate,
      };
    });
  }

  async generate(userId: string, plan: Plan, input: GenerateFlashcardsInput) {
    const { documentId, chunkIds, conceptId, type, limit, coverAll } = input;

    let atomChunkIds: string[] | null = null;
    if (conceptId) {
      const rows = await this.prisma.chunk_concept.findMany({
        where: { concept_id: conceptId, chunk: { document: { user_id: userId } } },
        select: { chunk_id: true },
      });
      atomChunkIds = rows.map((r) => r.chunk_id);
    }

    const candidateRows = await this.prisma.chunk.findMany({
      where: {
        document: { user_id: userId },
        ...(conceptId
          ? { id: { in: atomChunkIds ?? [] } }
          : documentId
            ? { document_id: documentId }
            : { id: { in: chunkIds ?? [] } }),
      },
      select: { id: true, document: { select: { workspace_id: true } } },
    });
    const candidates: Array<{ id: string; workspaceId: string | null }> = candidateRows.map(
      (c) => ({ id: c.id, workspaceId: c.document.workspace_id }),
    );

    if (candidates.length === 0) {
      return { created: 0, skipped: 0, total: 0, cards: [] };
    }

    const candidateIds = candidates.map((c) => c.id);
    const coveredRows = await this.prisma.flashcard.findMany({
      where: { user_id: userId, card_type: type, source_chunk_id: { in: candidateIds } },
      select: { source_chunk_id: true },
    });
    const covered = new Set(coveredRows.map((r) => r.source_chunk_id));
    const uncovered = candidates.filter((c) => !covered.has(c.id));
    const skipped = candidates.length - uncovered.length;

    const cap = coverAll ? COVER_ALL_MAX : limit;
    const toGen = uncovered.slice(0, cap);
    const remaining = uncovered.length - toGen.length;
    if (toGen.length === 0) {
      return { created: 0, skipped, remaining: 0, total: candidates.length, cards: [] };
    }

    const toGenIds = toGen.map((c) => c.id);
    const contentRows = await this.prisma.chunk.findMany({
      where: { id: { in: toGenIds } },
      select: { id: true, content: true },
    });
    const contentMap = new Map(contentRows.map((r) => [r.id, r.content]));
    const chunks = toGen.map((c) => ({
      id: c.id,
      content: contentMap.get(c.id) ?? '',
      workspaceId: c.workspaceId,
    }));

    const fetchedChunkIds = chunks.map((c) => c.id);
    const conceptLinks = await this.prisma.chunk_concept.findMany({
      where: { chunk_id: { in: fetchedChunkIds } },
      select: { chunk_id: true, concept_id: true },
    });
    const chunkToConcept = new Map<string, string>();
    for (const link of conceptLinks) {
      if (!chunkToConcept.has(link.chunk_id)) chunkToConcept.set(link.chunk_id, link.concept_id);
    }

    const genCtx: GenerateContext = { userId, plan };
    const allCards: Array<{
      type: 'BASIC' | 'CLOZE';
      front: string;
      back: string;
      sourceChunkId: string;
      workspaceId: string | null;
      conceptId: string | null;
    }> = [];
    for (let i = 0; i < chunks.length; i += GEN_CONCURRENCY) {
      const batch = chunks.slice(i, i + GEN_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (ch) => ({
          ch,
          cards: await (
            type === 'BASIC'
              ? this.gen.generateBasicCards(ch.content, genCtx)
              : this.gen.generateClozeCards(ch.content, genCtx)
          ).catch(() => [] as GeneratedCard[]),
        })),
      );
      for (const { ch, cards } of batchResults) {
        const cardConceptId = conceptId ?? chunkToConcept.get(ch.id) ?? null;
        for (const c of cards) {
          if (c.type === 'BASIC') {
            allCards.push({
              type: 'BASIC',
              front: c.front,
              back: c.back,
              sourceChunkId: ch.id,
              workspaceId: ch.workspaceId,
              conceptId: cardConceptId,
            });
          } else {
            allCards.push({
              type: 'CLOZE',
              front: c.text,
              back: '',
              sourceChunkId: ch.id,
              workspaceId: ch.workspaceId,
              conceptId: cardConceptId,
            });
          }
        }
      }
    }

    const seenCard = new Set<string>();
    const dedupedCards = allCards.filter((c) => {
      const key = `${c.type}|${c.front.trim().toLowerCase()}|${c.back.trim().toLowerCase()}`;
      if (seenCard.has(key)) return false;
      seenCard.add(key);
      return true;
    });

    if (dedupedCards.length === 0) {
      return { created: 0, skipped, remaining, total: candidates.length, cards: [] };
    }

    const fsrs = initFsrsFields();
    const inserted = await this.prisma.flashcard.createManyAndReturn({
      data: dedupedCards.map((c) => ({
        id: randomUUID(),
        user_id: userId,
        workspace_id: c.workspaceId,
        concept_id: c.conceptId,
        front: c.front,
        back: c.back,
        card_type: c.type,
        source_chunk_id: c.sourceChunkId,
        difficulty: fsrs.difficulty,
        stability: fsrs.stability,
        retrievability: fsrs.retrievability,
        state: fsrs.state,
        due: fsrs.due,
        last_review: fsrs.lastReview,
      })),
    });

    const touchedWorkspaces = new Set(inserted.map((c) => c.workspace_id));
    for (const ws of touchedWorkspaces) {
      await onFlashcardChanged(userId, ws);
    }
    if (conceptId) await onAtomChanged(userId, conceptId);

    return {
      created: inserted.length,
      skipped,
      remaining,
      total: candidates.length,
      cards: inserted.map((r) => this.toDto(r)),
    };
  }

  async uploadImage(userId: string, file?: UploadedImageFile) {
    if (!file) {
      throw new BadRequestException({ error: 'Cần field "file" dạng File' });
    }
    if (file.size > MAX_IMAGE_SIZE) {
      throw new HttpException({ error: `Ảnh quá lớn (>${MAX_IMAGE_SIZE / 1024 / 1024}MB)` }, 413);
    }
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new HttpException(
        { error: `Mime "${file.mimetype}" không hỗ trợ — chỉ PNG/JPEG/WEBP` },
        415,
      );
    }

    const ts = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const storageKey = `flashcards/${userId}/${ts}-${safeName}`;

    await this.storage.put(storageKey, file.buffer, file.mimetype);

    return {
      storageKey,
      url: `/api/flashcards/image/${encodeURIComponent(storageKey)}`,
    };
  }

  readImage(storageKey: string): Promise<Buffer> {
    return this.storage.get(storageKey);
  }
}
