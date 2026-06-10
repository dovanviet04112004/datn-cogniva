/**
 * MasteryUpdateService — cập nhật bảng `mastery` (BKT) sau mỗi observation
 * quiz/flashcard/exam. Port NGUYÊN semantics từ apps/web/src/lib/mastery/update.ts.
 *
 * Mỗi câu hỏi → 1 lần applyAttempt cho concept của câu đó:
 *   - Chưa có row (user × concept): INSERT với score = updateMastery(INITIAL, obs).
 *   - Có rồi: UPDATE score = updateMastery(currentScore, obs).
 *   - Counter `attempts` + `correct` (correct nếu score ≥ 0.5) phục vụ analytics.
 *
 * Race condition giữa 2 attempts đồng thời: chấp nhận overwrite (Phase 6 v1).
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { onMasteryChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';

/* ── BKT pure constants/fn — NGUỒN CHUẨN ở packages/shared/src/domain/bkt.ts
 *    (Corbett & Anderson 1995). Copy local vì shared là ESM-source, api CJS
 *    không require được — đổi công thức thì sửa cả 2. ─────────────────────── */

const P_INIT = 0.1;
const P_TRANSITION = 0.2;
const P_SLIP = 0.1;
const P_GUESS = 0.2;

/** Mức mastery khởi đầu (chưa có row trong bảng mastery) = p(L0). */
const INITIAL_SCORE = P_INIT;

/**
 * Cập nhật mastery score sau 1 lần trả lời: posterior 2 nhánh đúng/sai
 * interpolate theo score (0..1), rồi cộng transition p(T).
 */
function updateMastery(current: number, score: number): number {
  const pL = Math.max(0.001, Math.min(0.999, current));

  const pLgivenCorrect = (pL * (1 - P_SLIP)) / (pL * (1 - P_SLIP) + (1 - pL) * P_GUESS);
  const pLgivenWrong = (pL * P_SLIP) / (pL * P_SLIP + (1 - pL) * (1 - P_GUESS));

  const s = Math.max(0, Math.min(1, score));
  const posterior = s * pLgivenCorrect + (1 - s) * pLgivenWrong;

  const newScore = posterior + (1 - posterior) * P_TRANSITION;
  return Math.max(0, Math.min(1, newScore));
}

/**
 * Nguồn của observation — Phase A (atom-centric) cho phép mastery biết
 * user attempt qua format nào để analytics + study plan đa dạng hoá.
 */
export type MasterySource = 'quiz' | 'flashcard' | 'exam';

@Injectable()
export class MasteryUpdateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apply 1 observation cho 1 concept của 1 user.
   *
   * @param obsScore     Score quan sát (0..1) từ kết quả chấm câu hỏi.
   * @param source       Track timestamp riêng từng feature; default 'quiz'
   *                     (backward-compat caller cũ).
   * @param workspaceId  Truyền xuống onMasteryChanged để bust atom-list cache
   *                     NGAY (không chờ TTL 60s). Bỏ trống → dựa TTL.
   * @returns            Mastery score mới sau update.
   */
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
          // id sinh app-side (Drizzle cũ dùng cuid2 $defaultFn — DB không có default).
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
      // Mastery đổi → graph tô màu node theo mastery nên cache graph cũ. Choke point:
      // mọi đường (quiz/flashcard/exam/grade) đều qua applyAttempt → hook 1 chỗ phủ hết.
      // Truyền conceptId để bust luôn atom-view (preview) của đúng atom.
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
