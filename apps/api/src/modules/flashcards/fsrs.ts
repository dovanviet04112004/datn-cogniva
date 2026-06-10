/**
 * FSRS scheduler — port từ apps/web/src/lib/flashcards/fsrs.ts (Free Spaced
 * Repetition Scheduler). api dùng ts-fsrs 4.7 (web 4.6) — API tương thích,
 * semantics giữ nguyên: state machine NEW → LEARNING → REVIEW (lapse →
 * RELEARNING), rating 1-4 = Again/Hard/Good/Easy.
 *
 * `FsrsFields` copy từ packages/shared/src/domain/fsrs.ts — NGUỒN CHUẨN ở đó
 * (shared là ESM-source, api CJS không import được) — đổi shape thì sửa cả 2.
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

/** Field FSRS lưu trong DB. Mapping 1-1 với cột bảng flashcard. */
export type FsrsFields = {
  difficulty: number;
  stability: number;
  retrievability: number;
  state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
  due: Date;
  lastReview: Date | null;
};

/** Tham số default — `enable_fuzz` thêm random jitter ±5% để tránh "card cluster". */
const PARAMS = generatorParameters({
  enable_fuzz: true,
  // Retention mục tiêu — 0.9 cân bằng nhớ tốt vs số lần review/ngày
  request_retention: 0.9,
});

const scheduler = fsrs(PARAMS);

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
 * Throw nếu rating ngoài range — scheduler.next() từ chối Rating.Manual.
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
