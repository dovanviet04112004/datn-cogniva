/**
 * FSRS — phần logic THUẦN (không phụ thuộc `ts-fsrs`), share web + mobile.
 *
 * `ts-fsrs` (scheduler) chỉ chạy SERVER-SIDE ở web (apps/web/src/lib/flashcards/fsrs.ts)
 * vì review/schedule là quyết định của backend. Phần ở đây là:
 *   - `FsrsFields`: shape field FSRS lưu trong DB row (mapping 1-1 cột flashcard).
 *   - `computeRetrievability`: công thức retrievability THUẦN toán (Math.exp) để
 *     mobile/web tính nhanh client-side cho dashboard "retention rate".
 *
 * Lý do tách: packages/shared phải RN-safe, chỉ phụ thuộc zod — không kéo theo
 * `ts-fsrs` (chỉ web cần). Mobile hiển thị retention bằng `computeRetrievability`,
 * còn việc cập nhật lịch ôn vẫn gọi API server.
 */

/** Field FSRS lưu trong DB. Mapping 1-1 với cột bảng flashcard. */
export type FsrsFields = {
  difficulty: number;
  stability: number;
  retrievability: number;
  state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
  due: Date;
  lastReview: Date | null;
};

/**
 * Tính retrievability hiện tại — xác suất user nhớ card này ở thời điểm now.
 * Dùng cho dashboard "retention rate" và stats panel.
 *
 * FSRS formula: R(t) = exp(-t / (9 * S)) với t = số ngày từ lần review cuối,
 * S = stability (days).
 */
export function computeRetrievability(
  fields: FsrsFields,
  now: Date = new Date(),
): number {
  if (fields.stability <= 0 || !fields.lastReview) return 1; // chưa review → coi như nhớ
  const elapsedDays =
    (now.getTime() - fields.lastReview.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-elapsedDays / (9 * fields.stability));
}
