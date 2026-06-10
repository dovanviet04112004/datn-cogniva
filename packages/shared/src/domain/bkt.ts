/**
 * Bayesian Knowledge Tracing (BKT) — model 4 tham số cập nhật xác suất
 * user "biết" 1 concept qua từng lần trả lời.
 *
 * Logic THUẦN (không I/O, không native dep) → share giữa web + mobile:
 *   - web: API route mastery cập nhật score sau mỗi câu trả lời.
 *   - mobile: tính nhanh client-side để preview tiến độ trước khi sync.
 *
 * Tham số (kinh điển trong literature):
 *   p(L0) = 0.10   — xác suất ban đầu user đã biết concept (low default)
 *   p(T)  = 0.20   — xác suất chuyển từ "chưa biết" sang "biết" sau 1 lần học
 *   p(S)  = 0.10   — slip: biết nhưng vẫn trả lời sai
 *   p(G)  = 0.20   — guess: không biết nhưng đoán đúng
 *
 * Công thức update (Corbett & Anderson 1995):
 *   Bước 1 (posterior từ observation):
 *     p(L|đúng)  = p(L)(1-p(S)) / [p(L)(1-p(S)) + (1-p(L))p(G)]
 *     p(L|sai)   = p(L)p(S)    / [p(L)p(S)    + (1-p(L))(1-p(G))]
 *   Bước 2 (transition sau bước học):
 *     p(L_new)   = p(L|obs) + (1 - p(L|obs)) * p(T)
 *
 * Với câu hỏi không binary (SHORT có score 0..1), interpolate kết quả 2 nhánh:
 *     posterior = score * p(L|đúng) + (1-score) * p(L|sai)
 *
 * Forgetting curve (decay) tính riêng — xem `decay()` ở dưới.
 */

const P_INIT = 0.1;
const P_TRANSITION = 0.2;
const P_SLIP = 0.1;
const P_GUESS = 0.2;

/** Mức mastery khởi đầu (chưa có row trong bảng mastery). */
export const INITIAL_SCORE = P_INIT;

/**
 * Cập nhật mastery score sau 1 lần trả lời câu hỏi.
 *
 * @param current  Score hiện tại (0..1) — mặc định INITIAL_SCORE.
 * @param score    Kết quả trả lời (0..1) — 1 đúng hoàn toàn, 0 sai hoàn toàn.
 * @returns        Score mới (0..1).
 */
export function updateMastery(current: number, score: number): number {
  const pL = Math.max(0.001, Math.min(0.999, current));

  // Posterior sau 2 nhánh
  const pLgivenCorrect =
    (pL * (1 - P_SLIP)) / (pL * (1 - P_SLIP) + (1 - pL) * P_GUESS);
  const pLgivenWrong =
    (pL * P_SLIP) / (pL * P_SLIP + (1 - pL) * (1 - P_GUESS));

  // Trọng số theo score
  const s = Math.max(0, Math.min(1, score));
  const posterior = s * pLgivenCorrect + (1 - s) * pLgivenWrong;

  // Transition (cơ hội học được trong lần này, độc lập kết quả)
  const newScore = posterior + (1 - posterior) * P_TRANSITION;
  return Math.max(0, Math.min(1, newScore));
}

/**
 * Forgetting curve — giảm mastery theo thời gian không ôn lại.
 *
 * Mô hình exponential decay:
 *   score(t) = score_0 * exp(-λ * Δt_days)
 *   λ ≈ ln(2) / 14 days → mastery giảm 1 nửa sau 2 tuần không ôn.
 *
 * Decay áp dụng theo cron job hàng ngày (lib/mastery/decay-job hoặc thủ công).
 *
 * @param current        Score hiện tại.
 * @param daysSinceSeen  Số ngày kể từ lần cuối seen (lastSeenAt).
 * @returns              Score sau decay (≥ INITIAL_SCORE để không tụt về 0).
 */
export function decay(current: number, daysSinceSeen: number): number {
  if (daysSinceSeen <= 0) return current;
  const halfLifeDays = 14;
  const lambda = Math.LN2 / halfLifeDays;
  const decayed = current * Math.exp(-lambda * daysSinceSeen);
  // Floor ở INITIAL_SCORE để không bao giờ "quên hoàn toàn" — concept đã gặp
  // luôn có chút prior knowledge.
  return Math.max(INITIAL_SCORE, decayed);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Mastery LEVEL — phân tầng trạng thái học của 1 atom (concept) từ BKT score.
 *
 * Vì sao tồn tại: trước đây mỗi UI tự hardcode ngưỡng (0.85/0.3…) → lệch nhau +
 * khó hiểu. Gom về 1 nguồn THUẦN (web + mobile + server đều import) để "atom đã
 * hoàn thành/đang học/chưa học" nhất quán mọi nơi.
 *
 * KHÔNG cần bảng completion riêng: level suy ra trực tiếp từ mastery.score.
 *   - null  (chưa có mastery row) → 'new'      = Chưa học
 *   - < 0.8                        → 'learning' = Đang học
 *   - ≥ 0.8                        → 'mastered' = Đã nắm
 * ───────────────────────────────────────────────────────────────────────── */

/** Ngưỡng coi như "đã nắm" 1 atom (BKT posterior ≥ giá trị này). */
export const MASTERY_MASTERED = 0.8;

export type MasteryLevel = 'new' | 'learning' | 'mastered';

/**
 * Phân tầng atom từ mastery score. `null` = chưa từng attempt → 'new'.
 * Thuần (no I/O) → dùng được ở server route, web component, mobile.
 */
export function getMasteryLevel(score: number | null | undefined): MasteryLevel {
  if (score == null) return 'new';
  if (score >= MASTERY_MASTERED) return 'mastered';
  return 'learning';
}

/** Nhãn tiếng Việt cho từng level (text-only → an toàn cho cả mobile). */
export const MASTERY_LEVEL_LABEL: Record<MasteryLevel, string> = {
  new: 'Chưa học',
  learning: 'Đang học',
  mastered: 'Đã nắm',
};
