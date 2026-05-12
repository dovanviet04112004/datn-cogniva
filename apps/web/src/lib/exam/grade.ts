/**
 * Auto-grading logic cho exam responses (Phase 16).
 *
 * Hỗ trợ 7 type tự động chấm KHÔNG cần AI:
 *   - MCQ_SINGLE: 1 đáp án đúng — full points hoặc 0
 *   - MCQ_MULTI: nhiều đáp án — full nếu khớp hoàn toàn; partial nếu cho phép
 *   - TRUE_FALSE: boolean compare
 *   - FILL_BLANK: case-insensitive string match + acceptableAnswers
 *   - SHORT: cùng logic FILL_BLANK nhưng prompt thường mở hơn (fallback AI)
 *   - ORDERING: array equality; partial = % vị trí đúng
 *   - MATCHING: object equality; partial = % cặp đúng
 *
 * KHÔNG xử lý ở đây (chuyển sang `grade-short-answer.ts` AI):
 *   - ESSAY: cần rubric scoring qua Claude
 *   - SHORT khi câu trả lời mở rộng (vd "Giải thích về Big O") — semantic
 *     matching cần AI
 *   - CODE: cần test runner (Phase 18)
 *
 * Convention `answer` jsonb theo type — xem comment ở packages/db/src/schema.ts
 * (table `exam_question`).
 */

import type { ExamQuestion } from '@cogniva/db';

export interface GradeResult {
  isCorrect: boolean;
  pointsEarned: number;
  /** Cờ báo cần AI/manual grade tiếp — dùng cho SHORT khi auto-match fail. */
  needsAiGrading?: boolean;
  /** Reason cho needsAiGrading hoặc partial credit (debug). */
  detail?: string;
}

/**
 * Dispatch grading theo `question.type`. Trả {0 points, needsAiGrading: true}
 * cho ESSAY → caller decide có chạy AI grade hay defer manual review.
 */
export function gradeResponse(
  question: ExamQuestion,
  answer: unknown,
): GradeResult {
  if (answer === null || answer === undefined) {
    return { isCorrect: false, pointsEarned: 0, detail: 'no answer' };
  }

  switch (question.type) {
    case 'MCQ_SINGLE':
      return gradeMcqSingle(question, answer);
    case 'MCQ_MULTI':
      return gradeMcqMulti(question, answer);
    case 'TRUE_FALSE':
      return gradeTrueFalse(question, answer);
    case 'FILL_BLANK':
      return gradeFillBlank(question, answer);
    case 'SHORT':
      return gradeShort(question, answer);
    case 'ORDERING':
      return gradeOrdering(question, answer);
    case 'MATCHING':
      return gradeMatching(question, answer);
    case 'ESSAY':
      // Cần AI grading với rubric — caller xử lý
      return {
        isCorrect: false,
        pointsEarned: 0,
        needsAiGrading: true,
        detail: 'essay requires AI grading',
      };
    case 'CODE':
    case 'MATH':
    case 'DRAWING':
      // Phase 18+ — chưa support auto grade
      return {
        isCorrect: false,
        pointsEarned: 0,
        needsAiGrading: true,
        detail: `type ${question.type} chưa support auto grade`,
      };
    default:
      return {
        isCorrect: false,
        pointsEarned: 0,
        detail: `unknown type ${question.type}`,
      };
  }
}

// ──────────────────────────────────────────────────────────
// Individual graders
// ──────────────────────────────────────────────────────────

function gradeMcqSingle(question: ExamQuestion, answer: unknown): GradeResult {
  const correct = question.correctAnswer;
  if (typeof answer !== 'number' || typeof correct !== 'number') {
    return { isCorrect: false, pointsEarned: 0, detail: 'invalid types' };
  }
  const isCorrect = answer === correct;
  return { isCorrect, pointsEarned: isCorrect ? question.points : 0 };
}

/**
 * MCQ_MULTI: answer = number[]. correctAnswer = number[].
 *
 * Full credit khi 2 mảng equal (đúng tất cả + không chọn dư).
 * Partial credit (nếu `question.partialCredit = true`):
 *   - Đếm correct picks - incorrect picks, divide by total correct
 *   - Tối thiểu 0 (không trừ điểm dưới 0)
 */
function gradeMcqMulti(question: ExamQuestion, answer: unknown): GradeResult {
  const correct = question.correctAnswer;
  if (!Array.isArray(answer) || !Array.isArray(correct)) {
    return { isCorrect: false, pointsEarned: 0, detail: 'invalid types' };
  }
  const answerSet = new Set(answer as number[]);
  const correctSet = new Set(correct as number[]);

  const truePositives = [...answerSet].filter((x) => correctSet.has(x)).length;
  const falsePositives = [...answerSet].filter((x) => !correctSet.has(x)).length;

  const isCorrect =
    truePositives === correctSet.size && falsePositives === 0;

  if (isCorrect) {
    return { isCorrect: true, pointsEarned: question.points };
  }
  if (!question.partialCredit) {
    return { isCorrect: false, pointsEarned: 0 };
  }
  const partial =
    Math.max(0, (truePositives - falsePositives) / correctSet.size) *
    question.points;
  return { isCorrect: false, pointsEarned: partial, detail: 'partial credit' };
}

function gradeTrueFalse(question: ExamQuestion, answer: unknown): GradeResult {
  const correct = question.correctAnswer;
  if (typeof answer !== 'boolean' || typeof correct !== 'boolean') {
    return { isCorrect: false, pointsEarned: 0, detail: 'invalid types' };
  }
  const isCorrect = answer === correct;
  return { isCorrect, pointsEarned: isCorrect ? question.points : 0 };
}

/**
 * FILL_BLANK: case-insensitive + trim + accept alts.
 *
 * Match với `correctAnswer` (string) hoặc bất kỳ phần tử trong `acceptableAnswers`.
 * Tiếng Việt unicode normalize NFC để 'á' và 'á' (composite) match.
 */
function gradeFillBlank(question: ExamQuestion, answer: unknown): GradeResult {
  if (typeof answer !== 'string') {
    return { isCorrect: false, pointsEarned: 0, detail: 'answer not string' };
  }
  const normalize = (s: string) => s.normalize('NFC').trim().toLowerCase();
  const user = normalize(answer);
  if (!user) return { isCorrect: false, pointsEarned: 0 };

  const correct = typeof question.correctAnswer === 'string'
    ? normalize(question.correctAnswer)
    : '';
  const alts = (question.acceptableAnswers ?? []).map(normalize);

  const isCorrect = user === correct || alts.includes(user);
  return { isCorrect, pointsEarned: isCorrect ? question.points : 0 };
}

/**
 * SHORT: cùng logic FILL_BLANK, nhưng nếu fail thì flag `needsAiGrading`
 * để caller chạy AI semantic match. Tránh user mất điểm khi viết "Đạo hàm
 * sin x = cos x" trong khi `correctAnswer` ngắn gọn "cos(x)".
 */
function gradeShort(question: ExamQuestion, answer: unknown): GradeResult {
  const exact = gradeFillBlank(question, answer);
  if (exact.isCorrect) return exact;
  return {
    isCorrect: false,
    pointsEarned: 0,
    needsAiGrading: true,
    detail: 'exact match fail, AI semantic match needed',
  };
}

/**
 * ORDERING: answer = string[] đúng thứ tự. correctAnswer = string[].
 *
 * Full credit khi mảng equal element-wise.
 * Partial credit (nếu `partialCredit`):
 *   - Đếm vị trí đúng / tổng vị trí
 */
function gradeOrdering(question: ExamQuestion, answer: unknown): GradeResult {
  const correct = question.correctAnswer;
  if (!Array.isArray(answer) || !Array.isArray(correct)) {
    return { isCorrect: false, pointsEarned: 0, detail: 'invalid types' };
  }
  if (answer.length !== correct.length) {
    return { isCorrect: false, pointsEarned: 0, detail: 'length mismatch' };
  }
  const matches = (answer as string[]).reduce(
    (n, v, i) => (v === (correct as string[])[i] ? n + 1 : n),
    0,
  );
  const isCorrect = matches === correct.length;
  if (isCorrect) return { isCorrect: true, pointsEarned: question.points };
  if (!question.partialCredit) return { isCorrect: false, pointsEarned: 0 };
  return {
    isCorrect: false,
    pointsEarned: (matches / correct.length) * question.points,
    detail: `${matches}/${correct.length} positions correct`,
  };
}

/**
 * MATCHING: answer = { leftKey: rightValue }. correctAnswer = same shape.
 *
 * Full credit khi tất cả pairs đúng. Partial = % cặp đúng.
 */
function gradeMatching(question: ExamQuestion, answer: unknown): GradeResult {
  const correct = question.correctAnswer;
  if (
    typeof answer !== 'object' || answer === null || Array.isArray(answer) ||
    typeof correct !== 'object' || correct === null || Array.isArray(correct)
  ) {
    return { isCorrect: false, pointsEarned: 0, detail: 'invalid types' };
  }
  const userObj = answer as Record<string, string>;
  const correctObj = correct as Record<string, string>;

  const keys = Object.keys(correctObj);
  const matches = keys.reduce(
    (n, k) => (userObj[k] === correctObj[k] ? n + 1 : n),
    0,
  );
  const isCorrect = matches === keys.length;
  if (isCorrect) return { isCorrect: true, pointsEarned: question.points };
  if (!question.partialCredit) return { isCorrect: false, pointsEarned: 0 };
  return {
    isCorrect: false,
    pointsEarned: (matches / keys.length) * question.points,
    detail: `${matches}/${keys.length} pairs correct`,
  };
}
