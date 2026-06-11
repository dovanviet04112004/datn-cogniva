import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { onMasteryChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';

const P_INIT = 0.1;
const P_TRANSITION = 0.2;
const P_SLIP = 0.1;
const P_GUESS = 0.2;

const INITIAL_SCORE = P_INIT;

function updateMastery(current: number, score: number): number {
  const pL = Math.max(0.001, Math.min(0.999, current));

  const pLgivenCorrect = (pL * (1 - P_SLIP)) / (pL * (1 - P_SLIP) + (1 - pL) * P_GUESS);
  const pLgivenWrong = (pL * P_SLIP) / (pL * P_SLIP + (1 - pL) * (1 - P_GUESS));

  const s = Math.max(0, Math.min(1, score));
  const posterior = s * pLgivenCorrect + (1 - s) * pLgivenWrong;

  const newScore = posterior + (1 - posterior) * P_TRANSITION;
  return Math.max(0, Math.min(1, newScore));
}

export type MasterySource = 'quiz' | 'flashcard' | 'exam';

@Injectable()
export class MasteryUpdateService {
  constructor(private readonly prisma: PrismaService) {}

  async applyAttempt(
    userId: string,
    conceptId: string,
    obsScore: number,
    source: MasterySource = 'quiz',
    workspaceId?: string | null,
  ): Promise<number> {
    const existing = await this.prisma.mastery.findFirst({
      where: { user_id: userId, concept_id: conceptId },
    });

    const correctFlag = obsScore >= 0.5 ? 1 : 0;
    const now = new Date();
    const sourceTimestamps =
      source === 'flashcard'
        ? { last_flashcard_at: now }
        : source === 'exam'
          ? { last_exam_at: now }
          : { last_quiz_at: now };

    if (!existing) {
      const newScore = updateMastery(INITIAL_SCORE, obsScore);
      await this.prisma.mastery.create({
        data: {
          id: randomUUID(),
          user_id: userId,
          concept_id: conceptId,
          score: newScore,
          attempts: 1,
          correct: correctFlag,
          last_seen_at: now,
          ...sourceTimestamps,
        },
      });
      await onMasteryChanged(userId, workspaceId, conceptId);
      return newScore;
    }

    const newScore = updateMastery(existing.score, obsScore);
    await this.prisma.mastery.update({
      where: { id: existing.id },
      data: {
        score: newScore,
        attempts: existing.attempts + 1,
        correct: existing.correct + correctFlag,
        last_seen_at: now,
        ...sourceTimestamps,
      },
    });
    await onMasteryChanged(userId, workspaceId, conceptId);
    return newScore;
  }
}
