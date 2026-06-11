import { and, asc, eq, sql } from 'drizzle-orm';

import { db, studyPlanItem } from '@cogniva/db';

export type StudyPlanItemRow = typeof studyPlanItem.$inferSelect;

export async function getStudyPlanItems(
  userId: string,
  filters?: { status?: string | null; kind?: string | null },
): Promise<StudyPlanItemRow[]> {
  const where = [eq(studyPlanItem.userId, userId)];

  const status = filters?.status;
  if (status === 'PENDING' || status === 'DONE' || status === 'SKIPPED') {
    where.push(eq(studyPlanItem.status, status));
  }
  const kind = filters?.kind;
  if (kind === 'manual' || kind === 'review' || kind === 'new' || kind === 'practice') {
    where.push(eq(studyPlanItem.kind, kind));
  }

  return db
    .select()
    .from(studyPlanItem)
    .where(and(...where))
    .orderBy(sql`${studyPlanItem.dueDate} ASC NULLS LAST`, asc(studyPlanItem.createdAt));
}
