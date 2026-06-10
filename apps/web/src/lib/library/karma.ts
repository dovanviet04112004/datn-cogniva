/**
 * library/karma — Bonus #12 karma loop (Phase 3, 2026-05-27).
 *
 * Award karma points cho creator khi:
 *   - doc_imported  (+1) — best-effort gọi từ import endpoint
 *   - doc_remixed   (+5) — gọi từ remix endpoint cho mỗi source uploader
 *   - endorsed      (+10) — gọi từ endorse endpoint
 *   - high_quality  (+20) — gọi 1 lần khi quality_score crosses 80 threshold
 *
 * Upsert pattern: INSERT ... ON CONFLICT DO UPDATE points = points + N
 * + INSERT karma_event audit row.
 *
 * Spec: docs/plans/library-share.md §Bonus 12.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { db, libraryCreatorKarma, libraryKarmaEvent } from '@cogniva/db';

import { onKarmaChanged } from '@/lib/cache/invalidate';

export type KarmaEventType =
  | 'doc_imported'
  | 'doc_remixed'
  | 'endorsed'
  | 'high_quality'
  /** Phase 4 Step 5 — creator nhận khi 1 user mua premium doc. */
  | 'premium_sale';

const POINTS_BY_TYPE: Record<KarmaEventType, number> = {
  doc_imported: 1,
  doc_remixed: 5,
  endorsed: 10,
  high_quality: 20,
  premium_sale: 10,
};

/**
 * Award karma. Idempotent OK — duplicate events fine, points accumulate.
 */
export async function awardKarma(input: {
  userId: string;
  eventType: KarmaEventType;
  docId?: string;
  context?: Record<string, unknown>;
}): Promise<{ points: number; total: number }> {
  const points = POINTS_BY_TYPE[input.eventType];
  if (!points) return { points: 0, total: 0 };

  // Audit event
  await db.insert(libraryKarmaEvent).values({
    id: randomUUID(),
    userId: input.userId,
    eventType: input.eventType,
    points,
    docId: input.docId ?? null,
    context: input.context ?? null,
  });

  // Upsert karma row
  const result = await db
    .insert(libraryCreatorKarma)
    .values({
      userId: input.userId,
      points,
      lastEventAt: new Date(),
    })
    .onConflictDoUpdate({
      target: libraryCreatorKarma.userId,
      set: {
        points: sql`${libraryCreatorKarma.points} + ${points}`,
        lastEventAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning({ points: libraryCreatorKarma.points });

  // Karma đổi → bust cache karma-board. awardKarma là choke point cho cả 5 nguồn
  // (import/remix/endorse/purchase/quality) nên hook ở đây phủ tất cả by-construction.
  await onKarmaChanged();

  return {
    points,
    total: result[0]?.points ?? points,
  };
}
