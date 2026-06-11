import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { onMasteryChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import type { MarkMasteryInput } from './dto/mastery.dto';

const INITIAL_SCORE = 0.1;

function decay(current: number, daysSinceSeen: number): number {
  if (daysSinceSeen <= 0) return current;
  const halfLifeDays = 14;
  const lambda = Math.LN2 / halfLifeDays;
  const decayed = current * Math.exp(-lambda * daysSinceSeen);
  return Math.max(INITIAL_SCORE, decayed);
}

const LEVEL_SCORE = { learning: 0.6, mastered: 0.9 } as const;

export type Recommendation = {
  conceptId: string;
  conceptName: string;
  domain: string;
  mastery: number;
  prereqsFor: number;
  priority: number;
  reason: string;
};

@Injectable()
export class MasteryService {
  constructor(private readonly prisma: PrismaService) {}

  async listMastery(userId: string, limit: number, minAttempts: number) {
    const rows = await this.prisma.mastery.findMany({
      where: { user_id: userId, attempts: { gte: minAttempts } },
      orderBy: { score: 'asc' },
      take: limit,
      select: {
        concept_id: true,
        score: true,
        attempts: true,
        correct: true,
        last_seen_at: true,
        concept: { select: { name: true, domain: true } },
      },
    });
    return rows.map((r) => ({
      conceptId: r.concept_id,
      conceptName: r.concept.name,
      domain: r.concept.domain,
      score: r.score,
      attempts: r.attempts,
      correct: r.correct,
      lastSeenAt: r.last_seen_at,
    }));
  }

  async markMastery(userId: string, input: MarkMasteryInput) {
    const { conceptId, level, workspaceId } = input;
    const now = new Date();

    if (level === 'new') {
      await this.prisma.mastery.deleteMany({ where: { user_id: userId, concept_id: conceptId } });
    } else {
      const score = LEVEL_SCORE[level];
      const existing = await this.prisma.mastery.findFirst({
        where: { user_id: userId, concept_id: conceptId },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.mastery.update({
          where: { id: existing.id },
          data: { score, last_seen_at: now },
        });
      } else {
        await this.prisma.mastery.create({
          data: {
            id: randomUUID(),
            user_id: userId,
            concept_id: conceptId,
            score,
            attempts: 0,
            correct: 0,
            last_seen_at: now,
          },
        });
      }
    }

    await onMasteryChanged(userId, workspaceId, conceptId);
    return { ok: true };
  }

  async getRecommendations(userId: string, limit: number): Promise<Recommendation[]> {
    const conceptRows = await this.prisma.concept.findMany({
      where: { chunk_concept: { some: { chunk: { document: { user_id: userId } } } } },
      select: { id: true, name: true, domain: true },
    });
    if (conceptRows.length === 0) return [];
    const conceptIds = conceptRows.map((c) => c.id);

    const [masteryRows, prereqRows] = await Promise.all([
      this.prisma.mastery.findMany({
        where: { user_id: userId, concept_id: { in: conceptIds } },
        select: { concept_id: true, score: true },
      }),
      this.prisma.concept_relation.findMany({
        where: { relation_type: 'prerequisite', from_id: { in: conceptIds } },
        select: { from_id: true },
      }),
    ]);
    const masteryMap = new Map(masteryRows.map((m) => [m.concept_id, m.score]));
    const prereqCount = new Map<string, number>();
    for (const row of prereqRows) {
      prereqCount.set(row.from_id, (prereqCount.get(row.from_id) ?? 0) + 1);
    }

    const items: Recommendation[] = conceptRows.map((c) => {
      const score = masteryMap.get(c.id) ?? INITIAL_SCORE;
      const dependants = prereqCount.get(c.id) ?? 0;
      const weakness = 1 - score;
      const importance = 1 + Math.log(1 + dependants);
      const priority = weakness * importance;

      let reason: string;
      if (score < 0.4) {
        reason = `Mastery thấp (${(score * 100).toFixed(0)}%) — nên ưu tiên ôn.`;
      } else if (dependants > 0) {
        reason = `Là tiền đề của ${dependants} chủ đề khác — nắm vững giúp học các phần sau.`;
      } else {
        reason = `Mastery ${(score * 100).toFixed(0)}% — củng cố để giữ vững.`;
      }

      return {
        conceptId: c.id,
        conceptName: c.name,
        domain: c.domain,
        mastery: score,
        prereqsFor: dependants,
        priority,
        reason,
      };
    });

    items.sort((a, b) => b.priority - a.priority);
    return items.slice(0, limit);
  }

  async runDecay() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows = await this.prisma.mastery.findMany({
      where: { OR: [{ decayed_at: null }, { decayed_at: { lt: today } }] },
    });

    let updated = 0;
    for (const row of rows) {
      if (!row.last_seen_at) continue;
      const daysSinceSeen = (Date.now() - row.last_seen_at.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceSeen <= 0.5) continue;

      const newScore = decay(row.score, daysSinceSeen);
      if (Math.abs(newScore - row.score) < 0.001) {
        await this.prisma.mastery.update({
          where: { id: row.id },
          data: { decayed_at: new Date() },
        });
        continue;
      }
      await this.prisma.mastery.update({
        where: { id: row.id },
        data: { score: newScore, decayed_at: new Date() },
      });
      updated++;
    }

    return { scanned: rows.length, updated };
  }
}
