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

import { onMasteryChanged } from '@/lib/cache/invalidate';

import { INITIAL_SCORE, updateMastery } from './bkt';

/**
 * Nguồn của observation — Phase A (atom-centric) cho phép mastery biết
 * user attempt qua format nào để analytics + study plan đa dạng hoá.
 */
export type MasterySource = 'quiz' | 'flashcard' | 'exam';

/**
 * Apply 1 observation cho 1 concept của 1 user.
 *
 * @param userId
 * @param conceptId
 * @param obsScore  Score quan sát (0..1) từ kết quả chấm câu hỏi.
 * @param source    'quiz' | 'flashcard' | 'exam' — Phase A: track timestamp
 *                  riêng cho từng feature. Optional để backward-compat với
 *                  caller cũ (default 'quiz' vì đó là caller duy nhất trước
 *                  refactor).
 * @param workspaceId  Workspace user đang thao tác (review/quiz) — truyền xuống
 *                  onMasteryChanged để bust atom-list cache NGAY (không chờ TTL
 *                  60s). Optional: caller không biết ws → bỏ trống → dựa TTL.
 * @returns         Mastery score mới sau update.
 */
export async function applyAttempt(
  userId: string,
  conceptId: string,
  obsScore: number,
  source: MasterySource = 'quiz',
  workspaceId?: string | null,
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
  const sourceTimestamps =
    source === 'flashcard'
      ? { lastFlashcardAt: now }
      : source === 'exam'
        ? { lastExamAt: now }
        : { lastQuizAt: now };

  if (!existing) {
    const newScore = updateMastery(INITIAL_SCORE, obsScore);
    await db.insert(masteryTable).values({
      userId,
      conceptId,
      score: newScore,
      attempts: 1,
      correct: correctFlag,
      lastSeenAt: now,
      ...sourceTimestamps,
    });
    // Mastery đổi → graph tô màu node theo mastery nên cache graph cũ. Choke point:
    // mọi đường (quiz/flashcard/exam/grade) đều qua applyAttempt → hook 1 chỗ phủ hết.
    // Truyền conceptId để bust luôn atom-view (preview) của đúng atom.
    await onMasteryChanged(userId, workspaceId, conceptId);
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
      ...sourceTimestamps,
    })
    .where(eq(masteryTable.id, existing.id));
  // FIX: trước đây nhánh UPDATE (attempt thứ 2+) KHÔNG truyền workspaceId →
  // atom-list cache không bị bust → "đã học/đang học" trễ tới khi hết TTL. Giờ
  // truyền đủ workspaceId + conceptId để bust atom-list + atom-view ngay.
  await onMasteryChanged(userId, workspaceId, conceptId);
  return newScore;
}
