import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';

export type FsrsFields = {
  difficulty: number;
  stability: number;
  retrievability: number;
  state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
  due: Date;
  lastReview: Date | null;
};

const PARAMS = generatorParameters({
  enable_fuzz: true,
  request_retention: 0.9,
});

const scheduler = fsrs(PARAMS);

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
    retrievability: 0,
    state: stateMap[card.state],
    due: card.due,
    lastReview: card.last_review ?? null,
  };
}

export function initFsrsFields(now: Date = new Date()): FsrsFields {
  const empty = createEmptyCard(now);
  return fromFsrsCard(empty);
}

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
