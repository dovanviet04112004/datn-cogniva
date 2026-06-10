/**
 * library/quality-score — Pillar #5 Outcome-Verified Quality (Phase 2, 2026-05-27).
 *
 * Compute Quality Score (0-100) + auto-grant badges cho 1 library doc.
 * Formula weighted blend từ docs/plans/library-share.md §Pillar 5:
 *
 *   35% — outcome impact (avg pass rate từ library_doc_outcome rows)
 *   25% — workspace import rate (log scale signal)
 *   20% — engagement (download count log scale — proxy time-spent)
 *   10% — atom coverage (≥15 atoms = full coverage)
 *   10% — community rating (★avg × 20)
 *
 * Badge auto-grant (subset Phase 2):
 *   🏆 outcome_verified  — ≥3 outcome samples + avg ≥ 0.7
 *   🎯 syllabus_complete — atomCount ≥ 15
 *   ⚡ power_resource    — workspaceImportCount ≥ 50
 *
 * (educator_approved defer Phase 3 cần tutor verification)
 *
 * Pure function — không touch DB. DB IO ở `recomputeQualityForDoc()`.
 */
import { eq, sql, avg, count } from 'drizzle-orm';

import {
  db,
  libraryDoc,
  libraryDocAtom,
  libraryDocEndorsement,
  libraryDocOutcome,
  libraryKarmaEvent,
} from '@cogniva/db';

// ─── Pure compute function ───────────────────────────────────────────
export type QualityInput = {
  /** Avg outcome value (0..1) — pass rate avg, null nếu chưa có sample. */
  outcomeAvg: number | null;
  /** Số outcome samples đã ghi nhận. */
  outcomeSamples: number;
  /** workspace import count. */
  importCount: number;
  /** download count (engagement proxy). */
  downloadCount: number;
  /** atom count đã extract cho doc. */
  atomCount: number;
  /** rating_avg (1..5) hoặc null. */
  ratingAvg: number | null;
  /** số reviews — outcome cần đủ sample mới count. */
  ratingCount: number;
  /** Phase 3 — verified tutor endorsement count. */
  endorsementCount: number;
};

export type QualityResult = {
  /** Final score 0-100. */
  score: number;
  /** Breakdown từng component (cho admin debug + display). */
  breakdown: {
    outcome: number;
    import: number;
    engagement: number;
    atomCoverage: number;
    rating: number;
  };
  /** Badges auto-grant. */
  badges: string[];
};

/** Log-scale 0-100 (log10 base, cap ở val=1000). */
function logScale100(val: number, cap = 1000): number {
  if (val <= 0) return 0;
  const norm = Math.log10(val + 1) / Math.log10(cap + 1);
  return Math.min(100, Math.max(0, norm * 100));
}

/**
 * Compute quality score + badges từ stats. Pure, dễ test.
 */
export function computeQuality(input: QualityInput): QualityResult {
  // ── Outcome (35%) ──────────────────────────────────────────────────
  // Cần tối thiểu 3 samples mới count outcome — tránh 1-2 sample bias.
  const outcomeComponent =
    input.outcomeSamples >= 3 && input.outcomeAvg != null
      ? Math.min(100, Math.max(0, input.outcomeAvg * 100))
      : 0;

  // ── Import rate (25%) ──────────────────────────────────────────────
  const importComponent = logScale100(input.importCount, 1000);

  // ── Engagement (20%) — download count proxy ────────────────────────
  const engagementComponent = logScale100(input.downloadCount, 1000);

  // ── Atom coverage (10%) ────────────────────────────────────────────
  const atomComponent = Math.min(100, (input.atomCount / 15) * 100);

  // ── Community rating (10%) ─────────────────────────────────────────
  // Cần ≥3 reviews mới count. Map 1-5 → 0-100.
  const ratingComponent =
    input.ratingCount >= 3 && input.ratingAvg != null
      ? Math.min(100, Math.max(0, ((input.ratingAvg - 1) / 4) * 100))
      : 0;

  const score =
    outcomeComponent * 0.35 +
    importComponent * 0.25 +
    engagementComponent * 0.2 +
    atomComponent * 0.1 +
    ratingComponent * 0.1;

  // ── Badges auto-grant ──────────────────────────────────────────────
  const badges: string[] = [];
  if (input.outcomeSamples >= 3 && input.outcomeAvg != null && input.outcomeAvg >= 0.7) {
    badges.push('outcome_verified');
  }
  if (input.atomCount >= 15) {
    badges.push('syllabus_complete');
  }
  if (input.importCount >= 50) {
    badges.push('power_resource');
  }
  if (input.endorsementCount >= 1) {
    // Phase 3 — đủ 1 verified tutor endorse → grant educator_approved
    badges.push('educator_approved');
  }

  return {
    score: Math.round(score * 100) / 100, // 2 decimals
    breakdown: {
      outcome: Math.round(outcomeComponent * 100) / 100,
      import: Math.round(importComponent * 100) / 100,
      engagement: Math.round(engagementComponent * 100) / 100,
      atomCoverage: Math.round(atomComponent * 100) / 100,
      rating: Math.round(ratingComponent * 100) / 100,
    },
    badges,
  };
}

// ─── DB IO: recompute single doc ─────────────────────────────────────
export async function recomputeQualityForDoc(docId: string): Promise<QualityResult> {
  // Fetch doc stats
  const [doc] = await db
    .select({
      importCount: libraryDoc.workspaceImportCount,
      downloadCount: libraryDoc.downloadCount,
      ratingAvg: libraryDoc.ratingAvg,
      ratingCount: libraryDoc.ratingCount,
      uploaderId: libraryDoc.uploaderId,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, docId))
    .limit(1);
  if (!doc) throw new Error(`Library doc not found: ${docId}`);

  // Outcome aggregates (only score-type metrics for now)
  const [outcomeAgg] = await db
    .select({
      avg: avg(libraryDocOutcome.value),
      cnt: count(libraryDocOutcome.id),
    })
    .from(libraryDocOutcome)
    .where(
      sql`${libraryDocOutcome.docId} = ${docId} AND ${libraryDocOutcome.metric} IN ('exam_score', 'quiz_score')`,
    );

  const outcomeAvg = outcomeAgg?.avg ? Number(outcomeAgg.avg) : null;
  const outcomeSamples = outcomeAgg ? Number(outcomeAgg.cnt) : 0;

  // Atom count
  const [atomAgg] = await db
    .select({ cnt: count(libraryDocAtom.id) })
    .from(libraryDocAtom)
    .where(eq(libraryDocAtom.docId, docId));
  const atomCount = atomAgg ? Number(atomAgg.cnt) : 0;

  // Phase 3: endorsement count
  const [endorseAgg] = await db
    .select({ cnt: count(libraryDocEndorsement.id) })
    .from(libraryDocEndorsement)
    .where(eq(libraryDocEndorsement.docId, docId));
  const endorsementCount = endorseAgg ? Number(endorseAgg.cnt) : 0;

  const result = computeQuality({
    outcomeAvg,
    outcomeSamples,
    importCount: doc.importCount ?? 0,
    downloadCount: doc.downloadCount ?? 0,
    atomCount,
    ratingAvg: doc.ratingAvg != null ? Number(doc.ratingAvg) : null,
    ratingCount: doc.ratingCount ?? 0,
    endorsementCount,
  });

  // Persist
  await db
    .update(libraryDoc)
    .set({
      qualityScore: String(result.score), // numeric(5,2) drizzle → string
      qualityBreakdown: result.breakdown,
      badges: result.badges,
      updatedAt: new Date(),
    })
    .where(eq(libraryDoc.id, docId));

  // Phase 4 Karma high_quality trigger — score ≥ 80 → award uploader +20 karma
  // 1 lần / doc (idempotent guard qua library_karma_event lookup).
  if (result.score >= 80) {
    void (async () => {
      try {
        const [existing] = await db
          .select({ id: libraryKarmaEvent.id })
          .from(libraryKarmaEvent)
          .where(
            sql`${libraryKarmaEvent.userId} = ${doc.uploaderId} AND ${libraryKarmaEvent.docId} = ${docId} AND ${libraryKarmaEvent.eventType} = 'high_quality'`,
          )
          .limit(1);
        if (existing) return; // already awarded
        const { awardKarma } = await import('./karma');
        await awardKarma({
          userId: doc.uploaderId,
          eventType: 'high_quality',
          docId,
          context: { qualityScore: result.score },
        });
      } catch (err) {
        console.error('[quality.high_quality-karma]', err);
      }
    })();
  }

  return result;
}

/**
 * Recompute toàn bộ docs PUBLISHED — gọi qua cron Phase 4 hoặc on-demand admin.
 */
export async function recomputeQualityAll(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> {
  const docs = await db
    .select({ id: libraryDoc.id })
    .from(libraryDoc)
    .where(eq(libraryDoc.status, 'PUBLISHED'));

  let succeeded = 0;
  let failed = 0;
  for (const d of docs) {
    try {
      await recomputeQualityForDoc(d.id);
      succeeded++;
    } catch (err) {
      console.error('[quality.recompute]', d.id, err);
      failed++;
    }
  }
  return { total: docs.length, succeeded, failed };
}
