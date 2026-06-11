import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { KarmaService } from './karma.service';

export type QualityInput = {
  outcomeAvg: number | null;
  outcomeSamples: number;
  importCount: number;
  downloadCount: number;
  atomCount: number;
  ratingAvg: number | null;
  ratingCount: number;
  endorsementCount: number;
};

export type QualityResult = {
  score: number;
  breakdown: {
    outcome: number;
    import: number;
    engagement: number;
    atomCoverage: number;
    rating: number;
  };
  badges: string[];
};

function logScale100(val: number, cap = 1000): number {
  if (val <= 0) return 0;
  const norm = Math.log10(val + 1) / Math.log10(cap + 1);
  return Math.min(100, Math.max(0, norm * 100));
}

export function computeQuality(input: QualityInput): QualityResult {
  const outcomeComponent =
    input.outcomeSamples >= 3 && input.outcomeAvg != null
      ? Math.min(100, Math.max(0, input.outcomeAvg * 100))
      : 0;

  const importComponent = logScale100(input.importCount, 1000);
  const engagementComponent = logScale100(input.downloadCount, 1000);
  const atomComponent = Math.min(100, (input.atomCount / 15) * 100);

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
    badges.push('educator_approved');
  }

  return {
    score: Math.round(score * 100) / 100,
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

@Injectable()
export class QualityScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly karma: KarmaService,
  ) {}

  async recomputeQualityForDoc(docId: string): Promise<QualityResult> {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: {
        workspace_import_count: true,
        download_count: true,
        rating_avg: true,
        rating_count: true,
        uploader_id: true,
      },
    });
    if (!doc) throw new Error(`Library doc not found: ${docId}`);

    const [outcomeAgg] = await this.prisma.$queryRaw<
      Array<{ avg: string | null; cnt: number }>
    >(Prisma.sql`
      SELECT AVG(value)::text AS avg, COUNT(id)::int AS cnt
      FROM library_doc_outcome
      WHERE doc_id = ${docId} AND metric IN ('exam_score', 'quiz_score')
    `);
    const outcomeAvg = outcomeAgg?.avg ? Number(outcomeAgg.avg) : null;
    const outcomeSamples = outcomeAgg ? Number(outcomeAgg.cnt) : 0;

    const atomCount = await this.prisma.library_doc_atom.count({ where: { doc_id: docId } });
    const endorsementCount = await this.prisma.library_doc_endorsement.count({
      where: { doc_id: docId },
    });

    const result = computeQuality({
      outcomeAvg,
      outcomeSamples,
      importCount: doc.workspace_import_count ?? 0,
      downloadCount: doc.download_count ?? 0,
      atomCount,
      ratingAvg: doc.rating_avg != null ? Number(doc.rating_avg) : null,
      ratingCount: doc.rating_count ?? 0,
      endorsementCount,
    });

    await this.prisma.library_doc.update({
      where: { id: docId },
      data: {
        quality_score: String(result.score),
        quality_breakdown: result.breakdown,
        badges: result.badges,
        updated_at: new Date(),
      },
    });

    if (result.score >= 80) {
      void (async () => {
        try {
          const existing = await this.prisma.library_karma_event.findFirst({
            where: { user_id: doc.uploader_id, doc_id: docId, event_type: 'high_quality' },
            select: { id: true },
          });
          if (existing) return;
          await this.karma.awardKarma({
            userId: doc.uploader_id,
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

  async recomputeQualityAll(): Promise<{ total: number; succeeded: number; failed: number }> {
    const docs = await this.prisma.library_doc.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true },
    });

    let succeeded = 0;
    let failed = 0;
    for (const d of docs) {
      try {
        await this.recomputeQualityForDoc(d.id);
        succeeded++;
      } catch (err) {
        console.error('[quality.recompute]', d.id, err);
        failed++;
      }
    }
    return { total: docs.length, succeeded, failed };
  }
}
