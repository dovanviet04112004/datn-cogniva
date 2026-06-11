import { and, eq, gte, lt, ne } from 'drizzle-orm';

import { db, studyPlanItem } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

import { proposeForToday, type AtomBrief } from './propose';

export function studyPlanDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type ProposalItemRow = {
  id: string;
  title: string;
  description: string | null;
  status: 'PENDING' | 'DONE' | 'SKIPPED';
  kind: 'manual' | 'review' | 'new' | 'practice';
  conceptId: string | null;
  metadata: Record<string, unknown>;
  dueDate: Date | null;
  createdAt: Date;
  completedAt: Date | null;
};

function todayRange(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function buildRow(
  atom: AtomBrief,
  kind: 'review' | 'new' | 'practice',
): {
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
} {
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

export async function materializeProposalForToday(userId: string): Promise<ProposalItemRow[]> {
  return cached(ck.studyPlan(userId, studyPlanDayKey()), 60, () => doMaterialize(userId));
}

async function doMaterialize(userId: string): Promise<ProposalItemRow[]> {
  const { start, end } = todayRange();

  const existing = await db
    .select()
    .from(studyPlanItem)
    .where(
      and(
        eq(studyPlanItem.userId, userId),
        ne(studyPlanItem.kind, 'manual'),
        gte(studyPlanItem.createdAt, start),
        lt(studyPlanItem.createdAt, end),
      ),
    );

  if (existing.length > 0) {
    return existing as ProposalItemRow[];
  }

  const proposal = await proposeForToday(userId);

  const toInsert: Array<typeof studyPlanItem.$inferInsert> = [];
  for (const atom of proposal.review) {
    const { title, description, metadata } = buildRow(atom, 'review');
    toInsert.push({
      userId,
      title,
      description,
      conceptId: atom.id,
      kind: 'review',
      metadata,
      dueDate: start,
    });
  }
  for (const atom of proposal.newAtoms) {
    const { title, description, metadata } = buildRow(atom, 'new');
    toInsert.push({
      userId,
      title,
      description,
      conceptId: atom.id,
      kind: 'new',
      metadata,
      dueDate: start,
    });
  }
  for (const atom of proposal.practice) {
    const { title, description, metadata } = buildRow(atom, 'practice');
    toInsert.push({
      userId,
      title,
      description,
      conceptId: atom.id,
      kind: 'practice',
      metadata,
      dueDate: start,
    });
  }

  if (toInsert.length === 0) return [];

  const inserted = await db.insert(studyPlanItem).values(toInsert).returning();

  return inserted as ProposalItemRow[];
}
