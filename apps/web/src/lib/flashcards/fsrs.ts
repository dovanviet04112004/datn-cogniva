/**
 * FSRS wrapper — Free Spaced Repetition Scheduler (Jarrett Ye 2022+).
 *
 * Vì sao FSRS thay SM-2 (Anki cũ)?
 *   - SM-2 dùng heuristic fix difficulty → có user "leech" cards mãi.
 *   - FSRS train trên 1B+ reviews thực, optimize per-user retention target.
 *   - State machine 4 trạng thái (NEW → LEARNING → REVIEW; lapse → RELEARNING)
 *     match đúng enum trong schema (xem packages/db/src/schema.ts:97).
 *
 * Tham số FSRS trong row flashcard:
 *   - difficulty (0..10): độ khó nội tại sau N lần review
 *   - stability (days): memory strength — số ngày trước khi retrievability=90%
 *   - retrievability (0..1): xác suất nhớ tại thời điểm hiện tại
 *   - state, due, lastReview
 *
 * Rating mapping (schema review.rating 1-4 = FSRS Rating enum):
 *   1 = Again (quên) → state RELEARNING/LEARNING, due ngay
 *   2 = Hard (khó) → state tiếp tục, due ngắn
 *   3 = Good (đúng) → state advance, due bình thường
 *   4 = Easy (dễ) → state advance, due dài hơn
 */
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';

/** Tham số default — `enable_fuzz` thêm random jitter ±5% để tránh "card cluster". */
const PARAMS = generatorParameters({
  enable_fuzz: true,
  // Retention mục tiêu — 0.9 cân bằng nhớ tốt vs số lần review/ngày
  request_retention: 0.9,
});

const scheduler = fsrs(PARAMS);

/** Field FSRS lưu trong DB. Mapping 1-1 với cột bảng flashcard. */
export type FsrsFields = {
  difficulty: number;
  stability: number;
  retrievability: number;
  state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
  due: Date;
  lastReview: Date | null;
};

/** Convert DB row → ts-fsrs Card (state number, due Date). */
function toFsrsCard(fields: FsrsFields): FsrsCard {
  const stateMap: Record<FsrsFields['state'], State> = {
    NEW: State.New,
    LEARNING: State.Learning,
    REVIEW: State.Review,
    RELEARNING: State.Relearning,
  };
  return {
    due: fields.due,
    stability: fields.stability,
    difficulty: fields.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    state: stateMap[fields.state],
    last_review: fields.lastReview ?? undefined,
  };
}

/** Convert ts-fsrs Card → DB fields. */
function fromFsrsCard(card: FsrsCard): FsrsFields {
  const stateMap: Record<State, FsrsFields['state']> = {
    [State.New]: 'NEW',
    [State.Learning]: 'LEARNING',
    [State.Review]: 'REVIEW',
    [State.Relearning]: 'RELEARNING',
  };
  return {
    difficulty: card.difficulty,
    stability: card.stability,
    retrievability: 0, // sẽ tính lại khi đến review
    state: stateMap[card.state],
    due: card.due,
    lastReview: card.last_review ?? null,
  };
}

/**
 * Init tham số FSRS cho card mới — state NEW, due = now (xuất hiện trong queue
 * ngay lập tức).
 */
export function initFsrsFields(now: Date = new Date()): FsrsFields {
  const empty = createEmptyCard(now);
  return fromFsrsCard(empty);
}

/**
 * Map rating 1-4 (schema) → ts-fsrs Grade (Rating excluding Manual).
 * Throw nếu rating ngoài range (tránh data invalid lọt vào DB).
 *
 * Return type Grade chứ không Rating vì scheduler.next() từ chối Rating.Manual
 * (chỉ chấp nhận 4 grade thực: Again/Hard/Good/Easy).
 */
function toGrade(rating: number): Grade {
  switch (rating) {
    case 1:
      return Rating.Again;
    case 2:
      return Rating.Hard;
    case 3:
      return Rating.Good;
    case 4:
      return Rating.Easy;
    default:
      throw new Error(`[fsrs] Invalid rating ${rating} — chỉ chấp nhận 1-4`);
  }
}

/**
 * Tính state mới của card sau khi user review với rating.
 *
 * @param current - Field FSRS hiện tại từ DB
 * @param rating  - 1=Again, 2=Hard, 3=Good, 4=Easy
 * @param now     - Thời điểm review (default Date.now)
 * @returns Field FSRS mới — caller UPDATE row + INSERT review log
 */
export function applyReview(
  current: FsrsFields,
  rating: number,
  now: Date = new Date(),
): FsrsFields {
  const card = toFsrsCard(current);
  const grade = toGrade(rating);
  const result = scheduler.next(card, now, grade);
  return fromFsrsCard(result.card);
}

/**
 * Tính retrievability hiện tại — xác suất user nhớ card này ở thời điểm now.
 * Dùng cho dashboard "retention rate" và stats panel.
 */
export function computeRetrievability(fields: FsrsFields, now: Date = new Date()): number {
  if (fields.stability <= 0 || !fields.lastReview) return 1; // chưa review → coi như nhớ
  const elapsedDays = (now.getTime() - fields.lastReview.getTime()) / (1000 * 60 * 60 * 24);
  // FSRS formula: R(t) = exp(-t / (9 * S))
  return Math.exp(-elapsedDays / (9 * fields.stability));
}
