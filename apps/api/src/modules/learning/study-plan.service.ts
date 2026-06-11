import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type study_plan_item as StudyPlanItemRow } from '@prisma/client';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { onStudyPlanChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import type { CreateStudyPlanInput, PatchStudyPlanInput } from './dto/study-plan.dto';

interface StudyPlanItemDto {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  conceptId: string | null;
  status: 'PENDING' | 'DONE' | 'SKIPPED';
  kind: 'manual' | 'review' | 'new' | 'practice';
  metadata: unknown;
  dueDate: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}

function studyPlanDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayRange(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

type AtomBrief = {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  difficulty: number | null;
  previewQuestion: string | null;
  previewAnswer: string | null;
  flashcardCount: number;
  questionCount: number;
  masteryScore: number | null;
  earliestDue: Date | null;
};

type StudyPlanProposal = {
  review: AtomBrief[];
  newAtoms: AtomBrief[];
  practice: AtomBrief[];
};

const REVIEW_LIMIT = 5;
const NEW_LIMIT = 2;
const PRACTICE_LIMIT = 3;

function buildRow(
  atom: AtomBrief,
  kind: 'review' | 'new' | 'practice',
): { title: string; description: string | null; metadata: Record<string, unknown> } {
  const titlePrefix = kind === 'review' ? 'Ôn ' : kind === 'new' ? 'Học atom mới: ' : 'Quiz: ';
  return {
    title: `${titlePrefix}${atom.name}`,
    description: atom.previewAnswer ?? atom.description ?? null,
    metadata: {
      atomDomain: atom.domain,
      atomDifficulty: atom.difficulty,
      masteryScore: atom.masteryScore,
      flashcardCount: atom.flashcardCount,
      questionCount: atom.questionCount,
      previewQuestion: atom.previewQuestion,
      previewAnswer: atom.previewAnswer,
      earliestDue: atom.earliestDue?.toISOString() ?? null,
      estimatedMinutes: kind === 'review' ? 2 : kind === 'new' ? 5 : 3,
    },
  };
}

@Injectable()
export class StudyPlanService {
  constructor(private readonly prisma: PrismaService) {}

  private toItemDto(row: StudyPlanItemRow): StudyPlanItemDto {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      description: row.description,
      conceptId: row.concept_id,
      status: row.status,
      kind: row.kind,
      metadata: row.metadata,
      dueDate: row.due_date,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  async listItems(
    userId: string,
    filters: { status: string | null; kind: string | null },
  ): Promise<StudyPlanItemDto[]> {
    const where: Prisma.study_plan_itemWhereInput = { user_id: userId };

    const { status, kind } = filters;
    if (status === 'PENDING' || status === 'DONE' || status === 'SKIPPED') {
      where.status = status;
    }
    if (kind === 'manual' || kind === 'review' || kind === 'new' || kind === 'practice') {
      where.kind = kind;
    }

    const rows = await this.prisma.study_plan_item.findMany({
      where,
      orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
    });
    return rows.map((r) => this.toItemDto(r));
  }

  async createItem(userId: string, input: CreateStudyPlanInput) {
    const inserted = await this.prisma.study_plan_item.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        title: input.title,
        description: input.description ?? null,
        concept_id: input.conceptId ?? null,
        due_date: input.dueDate ? new Date(input.dueDate) : null,
      },
    });

    await onStudyPlanChanged(userId, studyPlanDayKey());
    return { item: this.toItemDto(inserted) };
  }

  async updateItem(userId: string, id: string, input: PatchStudyPlanInput) {
    const existing = await this.prisma.study_plan_item.findFirst({
      where: { id, user_id: userId },
    });
    if (!existing) throw new NotFoundException({ error: 'Not found' });

    const data: Prisma.study_plan_itemUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.dueDate !== undefined) data.due_date = input.dueDate ? new Date(input.dueDate) : null;
    if (input.status !== undefined) {
      data.status = input.status;
      data.completed_at = input.status === 'DONE' ? new Date() : null;
    }

    const updated = await this.prisma.study_plan_item.update({ where: { id }, data });

    await onStudyPlanChanged(userId, studyPlanDayKey());
    return { item: this.toItemDto(updated) };
  }

  async deleteItem(userId: string, id: string) {
    const result = await this.prisma.study_plan_item.deleteMany({
      where: { id, user_id: userId },
    });
    if (result.count === 0) throw new NotFoundException({ error: 'Not found' });

    await onStudyPlanChanged(userId, studyPlanDayKey());
    return { deleted: true };
  }

  async skipItem(userId: string, id: string) {
    const item = await this.prisma.study_plan_item.findFirst({
      where: { id, user_id: userId, kind: { not: 'manual' } },
    });
    if (!item) throw new NotFoundException({ error: 'Not found' });
    if (item.status !== 'PENDING') {
      throw new ConflictException({ error: `Item đã ${item.status}, không skip được` });
    }

    const updated = await this.prisma.study_plan_item.update({
      where: { id },
      data: { status: 'SKIPPED', completed_at: new Date() },
    });

    await onStudyPlanChanged(userId, studyPlanDayKey());
    return { item: this.toItemDto(updated) };
  }

  async materializeProposalForToday(userId: string): Promise<StudyPlanItemDto[]> {
    return cached(ck.studyPlan(userId, studyPlanDayKey()), 60, () => this.doMaterialize(userId));
  }

  private async doMaterialize(userId: string): Promise<StudyPlanItemDto[]> {
    const { start, end } = todayRange();

    const existing = await this.prisma.study_plan_item.findMany({
      where: {
        user_id: userId,
        kind: { not: 'manual' },
        created_at: { gte: start, lt: end },
      },
    });
    if (existing.length > 0) return existing.map((r) => this.toItemDto(r));

    const proposal = await this.proposeForToday(userId);

    const toInsert: Prisma.study_plan_itemCreateManyInput[] = [];
    const pushRows = (atoms: AtomBrief[], kind: 'review' | 'new' | 'practice') => {
      for (const atom of atoms) {
        const { title, description, metadata } = buildRow(atom, kind);
        toInsert.push({
          id: randomUUID(),
          user_id: userId,
          title,
          description,
          concept_id: atom.id,
          kind,
          metadata: metadata as Prisma.InputJsonValue,
          due_date: start,
        });
      }
    };
    pushRows(proposal.review, 'review');
    pushRows(proposal.newAtoms, 'new');
    pushRows(proposal.practice, 'practice');

    if (toInsert.length === 0) return [];

    const inserted = await this.prisma.study_plan_item.createManyAndReturn({ data: toInsert });
    return inserted.map((r) => this.toItemDto(r));
  }

  private async proposeForToday(userId: string): Promise<StudyPlanProposal> {
    const now = new Date();

    const reviewRows = await this.prisma.$queryRaw<
      Array<{ concept_id: string; earliest_due: Date }>
    >(
      Prisma.sql`
        SELECT concept_id, MIN(due) AS earliest_due
        FROM flashcard
        WHERE user_id = ${userId}
          AND due < ${now}
          AND concept_id IS NOT NULL
        GROUP BY concept_id
        ORDER BY MIN(due) ASC
        LIMIT ${REVIEW_LIMIT}`,
    );
    const reviewConceptIds = reviewRows.map((r) => r.concept_id);

    const newAtomRows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; difficulty: number | null }>
    >(
      Prisma.sql`
        SELECT c.id, c.name, c.difficulty
        FROM concept c
        WHERE c.id IN (
            SELECT DISTINCT cc.concept_id
            FROM chunk_concept cc
            INNER JOIN chunk ch ON ch.id = cc.chunk_id
            INNER JOIN document d ON d.id = ch.document_id
            WHERE d.user_id = ${userId}
          )
          AND NOT EXISTS (
            SELECT 1 FROM mastery m
            WHERE m.user_id = ${userId}
              AND m.concept_id = c.id
          )
        ORDER BY c.difficulty ASC NULLS LAST
        LIMIT ${NEW_LIMIT}`,
    );

    const practiceRows = await this.prisma.$queryRaw<Array<{ concept_id: string; score: number }>>(
      Prisma.sql`
        SELECT concept_id, score
        FROM mastery
        WHERE user_id = ${userId}
          AND score < 0.5
          AND EXISTS (
            SELECT 1 FROM question q WHERE q.concept_id = mastery.concept_id
          )
        ORDER BY score ASC
        LIMIT ${PRACTICE_LIMIT}`,
    );
    const practiceConceptIds = practiceRows.map((r) => r.concept_id);

    const allConceptIds = Array.from(
      new Set([...reviewConceptIds, ...newAtomRows.map((c) => c.id), ...practiceConceptIds]),
    );

    const briefs = new Map<string, AtomBrief>();
    if (allConceptIds.length > 0) {
      const [conceptRows, masteryRows, fcCounts, qCounts] = await Promise.all([
        this.prisma.concept.findMany({
          where: { id: { in: allConceptIds } },
          select: {
            id: true,
            name: true,
            description: true,
            domain: true,
            difficulty: true,
            preview_question: true,
            preview_answer: true,
          },
        }),
        this.prisma.mastery.findMany({
          where: { user_id: userId, concept_id: { in: allConceptIds } },
          select: { concept_id: true, score: true },
        }),
        this.prisma.$queryRaw<Array<{ concept_id: string; n: number }>>(
          Prisma.sql`
            SELECT concept_id, COUNT(*)::int AS n
            FROM flashcard
            WHERE user_id = ${userId}
              AND concept_id IN (${Prisma.join(allConceptIds)})
            GROUP BY concept_id`,
        ),
        this.prisma.$queryRaw<Array<{ concept_id: string; n: number }>>(
          Prisma.sql`
            SELECT concept_id, COUNT(*)::int AS n
            FROM question
            WHERE concept_id IN (${Prisma.join(allConceptIds)})
            GROUP BY concept_id`,
        ),
      ]);

      const masteryMap = new Map(masteryRows.map((m) => [m.concept_id, m.score]));
      const fcMap = new Map(fcCounts.map((c) => [c.concept_id, c.n]));
      const qMap = new Map(qCounts.map((c) => [c.concept_id, c.n]));
      const dueMap = new Map(reviewRows.map((r) => [r.concept_id, new Date(r.earliest_due)]));

      for (const c of conceptRows) {
        briefs.set(c.id, {
          id: c.id,
          name: c.name,
          description: c.description,
          domain: c.domain,
          difficulty: c.difficulty,
          previewQuestion: c.preview_question,
          previewAnswer: c.preview_answer,
          flashcardCount: fcMap.get(c.id) ?? 0,
          questionCount: qMap.get(c.id) ?? 0,
          masteryScore: masteryMap.get(c.id) ?? null,
          earliestDue: dueMap.get(c.id) ?? null,
        });
      }
    }

    const pick = (ids: string[]) =>
      ids.map((id) => briefs.get(id)).filter((b): b is AtomBrief => b !== undefined);
    return {
      review: pick(reviewConceptIds),
      newAtoms: pick(newAtomRows.map((c) => c.id)),
      practice: pick(practiceConceptIds),
    };
  }
}
