/**
 * Helper cập nhật bảng `mastery` sau mỗi quiz attempt.
 *
 * Mỗi câu hỏi → 1 lần update mastery cho concept của câu đó.
 * - Nếu chưa có row cho (user × concept): INSERT với score = updateMastery(INITIAL, obs).
 * - Nếu có rồi: UPDATE score = updateMastery(currentScore, obs).
 *
 * Cập nhật cả counter `attempts` + `correct` (correct nếu score ≥ 0.5):
 *   - phục vụ analytics + UI hiển thị accuracy.
 *
 * Race condition giữa 2 attempts đồng thời: chấp nhận overwrite,
 * trade-off đơn giản (Phase 6 v1). Phase sau có thể dùng row-level lock.
 */
import { and, eq } from 'drizzle-orm';

import { db, mastery as masteryTable } from '@cogniva/db';

import { INITIAL_SCORE, updateMastery } from './bkt';

/**
 * Apply 1 observation cho 1 concept của 1 user.
 *
 * @param userId
 * @param conceptId
 * @param obsScore  Score quan sát (0..1) từ kết quả chấm câu hỏi.
 * @returns         Mastery score mới sau update.
 */
export async function applyAttempt(
  userId: string,
  conceptId: string,
  obsScore: number,
): Promise<number> {
  const [existing] = await db
    .select()
    .from(masteryTable)
    .where(
      and(eq(masteryTable.userId, userId), eq(masteryTable.conceptId, conceptId)),
    )
    .limit(1);

  const correctFlag = obsScore >= 0.5 ? 1 : 0;
  const now = new Date();

  if (!existing) {
    const newScore = updateMastery(INITIAL_SCORE, obsScore);
    await db.insert(masteryTable).values({
      userId,
      conceptId,
      score: newScore,
      attempts: 1,
      correct: correctFlag,
      lastSeenAt: now,
    });
    return newScore;
  }

  const newScore = updateMastery(existing.score, obsScore);
  await db
    .update(masteryTable)
    .set({
      score: newScore,
      attempts: existing.attempts + 1,
      correct: existing.correct + correctFlag,
      lastSeenAt: now,
    })
    .where(eq(masteryTable.id, existing.id));
  return newScore;
}
