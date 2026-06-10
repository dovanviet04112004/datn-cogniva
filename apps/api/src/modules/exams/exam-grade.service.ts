/**
 * ExamGradeService — auto-grading exam responses, port NGUYÊN semantics từ
 * apps/web/src/lib/exam/grade.ts (Phase 16). Khác duy nhất: nhận row Prisma
 * snake_case thay vì Drizzle camelCase.
 *
 * Hỗ trợ 7 type tự động chấm KHÔNG cần AI:
 *   - MCQ_SINGLE: 1 đáp án đúng — full points hoặc 0
 *   - MCQ_MULTI: nhiều đáp án — full nếu khớp hoàn toàn; partial nếu cho phép
 *   - TRUE_FALSE: boolean compare
 *   - FILL_BLANK: case-insensitive string match + acceptableAnswers
 *   - SHORT: cùng logic FILL_BLANK nhưng fallback AI khi exact match fail
 *   - ORDERING: array equality; partial = % vị trí đúng
 *   - MATCHING: object equality; partial = % cặp đúng
 *
 * ESSAY / CODE / MATH / DRAWING → needsAiGrading (ExamAiService / manual).
 */
import { Injectable } from '@nestjs/common';
import type { exam_question as ExamQuestionRow } from '@prisma/client';

export interface GradeResult {
  isCorrect: boolean;
  pointsEarned: number;
  /** Cờ báo cần AI/manual grade tiếp — dùng cho SHORT khi auto-match fail. */
  needsAiGrading?: boolean;
  /** Reason cho needsAiGrading hoặc partial credit (debug). */
  detail?: string;
}

@Injectable()
export class ExamGradeService {
  /**
   * Dispatch grading theo `question.type`. Trả {0 points, needsAiGrading: true}
   * cho ESSAY → caller decide có chạy AI grade hay defer manual review.
   */
  gradeResponse(question: ExamQuestionRow, answer: unknown): GradeResult {
    if (answer === null || answer === undefined) {
      return { isCorrect: false, pointsEarned: 0, detail: 'no answer' };
    }

    switch (question.type) {
      case 'MCQ_SINGLE':
        return this.gradeMcqSingle(question, answer);
      case 'MCQ_MULTI':
        return this.gradeMcqMulti(question, answer);
      case 'TRUE_FALSE':
        return this.gradeTrueFalse(question, answer);
      case 'FILL_BLANK':
        return this.gradeFillBlank(question, answer);
      case 'SHORT':
        return this.gradeShort(question, answer);
      case 'ORDERING':
        return this.gradeOrdering(question, answer);
      case 'MATCHING':
        return this.gradeMatching(question, answer);
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

  private gradeMcqSingle(question: ExamQuestionRow, answer: unknown): GradeResult {
    const correct = question.correct_answer;
    if (typeof answer !== 'number' || typeof correct !== 'number') {
      return { isCorrect: false, pointsEarned: 0, detail: 'invalid types' };
    }
    const isCorrect = answer === correct;
    return { isCorrect, pointsEarned: isCorrect ? question.points : 0 };
  }

  /**
   * MCQ_MULTI: answer = number[]. correctAnswer = number[].
   * Full credit khi 2 mảng equal; partial (nếu partialCredit) =
   * max(0, (đúng - dư) / tổng đúng) × points.
   */
  private gradeMcqMulti(question: ExamQuestionRow, answer: unknown): GradeResult {
    const correct = question.correct_answer;
    if (!Array.isArray(answer) || !Array.isArray(correct)) {
      return { isCorrect: false, pointsEarned: 0, detail: 'invalid types' };
    }
    const answerSet = new Set(answer as number[]);
    const correctSet = new Set(correct as number[]);

    const truePositives = [...answerSet].filter((x) => correctSet.has(x)).length;
    const falsePositives = [...answerSet].filter((x) => !correctSet.has(x)).length;

    const isCorrect = truePositives === correctSet.size && falsePositives === 0;

    if (isCorrect) {
      return { isCorrect: true, pointsEarned: question.points };
    }
    if (!question.partial_credit) {
      return { isCorrect: false, pointsEarned: 0 };
    }
    const partial =
      Math.max(0, (truePositives - falsePositives) / correctSet.size) * question.points;
    return { isCorrect: false, pointsEarned: partial, detail: 'partial credit' };
  }

  private gradeTrueFalse(question: ExamQuestionRow, answer: unknown): GradeResult {
    const correct = question.correct_answer;
    if (typeof answer !== 'boolean' || typeof correct !== 'boolean') {
      return { isCorrect: false, pointsEarned: 0, detail: 'invalid types' };
    }
    const isCorrect = answer === correct;
    return { isCorrect, pointsEarned: isCorrect ? question.points : 0 };
  }

  /**
   * FILL_BLANK: case-insensitive + trim + accept alts. Unicode normalize NFC
   * để 'á' và 'á' (composite) match.
   */
  private gradeFillBlank(question: ExamQuestionRow, answer: unknown): GradeResult {
    if (typeof answer !== 'string') {
      return { isCorrect: false, pointsEarned: 0, detail: 'answer not string' };
    }
    const normalize = (s: string) => s.normalize('NFC').trim().toLowerCase();
    const user = normalize(answer);
    if (!user) return { isCorrect: false, pointsEarned: 0 };

    const correct =
      typeof question.correct_answer === 'string' ? normalize(question.correct_answer) : '';
    const alts = ((question.acceptable_answers as string[] | null) ?? []).map(normalize);

    const isCorrect = user === correct || alts.includes(user);
    return { isCorrect, pointsEarned: isCorrect ? question.points : 0 };
  }

  /**
   * SHORT: cùng logic FILL_BLANK, nhưng nếu fail thì flag `needsAiGrading`
   * để caller chạy AI semantic match (tránh false negative khi student viết dài).
   */
  private gradeShort(question: ExamQuestionRow, answer: unknown): GradeResult {
    const exact = this.gradeFillBlank(question, answer);
    if (exact.isCorrect) return exact;
    return {
      isCorrect: false,
      pointsEarned: 0,
      needsAiGrading: true,
      detail: 'exact match fail, AI semantic match needed',
    };
  }

  /** ORDERING: full khi equal element-wise; partial = % vị trí đúng. */
  private gradeOrdering(question: ExamQuestionRow, answer: unknown): GradeResult {
    const correct = question.correct_answer;
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
    if (!question.partial_credit) return { isCorrect: false, pointsEarned: 0 };
    return {
      isCorrect: false,
      pointsEarned: (matches / correct.length) * question.points,
      detail: `${matches}/${correct.length} positions correct`,
    };
  }

  /** MATCHING: answer = { leftKey: rightValue }. Full khi mọi cặp đúng; partial = % cặp. */
  private gradeMatching(question: ExamQuestionRow, answer: unknown): GradeResult {
    const correct = question.correct_answer;
    if (
      typeof answer !== 'object' || answer === null || Array.isArray(answer) ||
      typeof correct !== 'object' || correct === null || Array.isArray(correct)
    ) {
      return { isCorrect: false, pointsEarned: 0, detail: 'invalid types' };
    }
    const userObj = answer as Record<string, string>;
    const correctObj = correct as Record<string, string>;

    const keys = Object.keys(correctObj);
    const matches = keys.reduce((n, k) => (userObj[k] === correctObj[k] ? n + 1 : n), 0);
    const isCorrect = matches === keys.length;
    if (isCorrect) return { isCorrect: true, pointsEarned: question.points };
    if (!question.partial_credit) return { isCorrect: false, pointsEarned: 0 };
    return {
      isCorrect: false,
      pointsEarned: (matches / keys.length) * question.points,
      detail: `${matches}/${keys.length} pairs correct`,
    };
  }
}
