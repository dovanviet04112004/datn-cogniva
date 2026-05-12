/**
 * AI grading cho ESSAY + SHORT (semantic fallback) — Phase 16.
 *
 * Dùng routedGenerateText với useCase 'reasoning' (Anthropic Opus primary,
 * Sonnet fallback) — yêu cầu accuracy cao cho fair grading.
 *
 * Output format JSON strict (zod validate):
 *   { score: 0..points, isCorrect: bool, feedback: string, breakdown?: {criterion: score} }
 *
 * Use cases:
 *   1. SHORT question — student trả lời mở rộng, exact match fail → AI quyết
 *      định có acceptable không (semantic equivalence).
 *   2. ESSAY question — rubric multi-criterion scoring.
 *
 * Token budget: ~500 tokens prompt + 300 tokens response per grade.
 * Cost ~$0.005/grade với Opus. Cho 1 exam 10 essay → ~$0.05. Chấp nhận.
 *
 * Lưu ý: NOT cache vì mỗi answer khác nhau. Caller có thể cache nếu nhiều
 * học sinh nộp cùng đáp án (vd 1 lớp 30 em) — implement ở caller.
 */
import { z } from 'zod';

import type { ExamQuestion } from '@cogniva/db';
import { routedGenerateText } from './router';
import type { Plan } from '../observability/cost-guardrail';
import { logger } from '../observability/logger';

export interface AiGradeResult {
  score: number;
  isCorrect: boolean;
  feedback: string;
  /** Map criterion → score (chỉ có với ESSAY rubric). */
  breakdown?: Record<string, number>;
  /** Cờ báo grading nên review tay (vd answer rỗng, off-topic, …). */
  flaggedForReview?: boolean;
  /** Error nếu AI call fail — fallback 0 điểm. */
  error?: string;
}

const RESPONSE_SCHEMA = z.object({
  score: z.number(),
  isCorrect: z.boolean(),
  feedback: z.string(),
  breakdown: z.record(z.string(), z.number()).optional(),
  flaggedForReview: z.boolean().optional(),
});

interface GradeContext {
  userId: string;
  plan: Plan;
}

/**
 * Grade SHORT question — semantic equivalence check.
 *
 * Khi user trả "Đạo hàm của sin x là cos x", correctAnswer = "cos(x)" → AI
 * decide accept hay không. Tránh false negative do exact match strict.
 */
export async function aiGradeShortAnswer(
  question: ExamQuestion,
  answer: string,
  ctx: GradeContext,
): Promise<AiGradeResult> {
  if (!answer.trim()) {
    return { score: 0, isCorrect: false, feedback: 'Không có câu trả lời.' };
  }

  const correct = typeof question.correctAnswer === 'string'
    ? question.correctAnswer
    : JSON.stringify(question.correctAnswer);
  const alts = (question.acceptableAnswers ?? []).join(' | ');

  const system = `Bạn là chấm bài câu hỏi ngắn. Đọc câu hỏi + đáp án chuẩn + câu trả lời của học sinh, quyết định có chấp nhận hay không.

Nguyên tắc:
- Chấp nhận nếu học sinh trả đúng ý chính (semantic equivalence), không bắt buộc khớp từng chữ
- Bỏ qua khác biệt nhỏ: dấu chấm phẩy, viết hoa, đơn vị (m/mét), thứ tự từ
- KHÔNG chấp nhận nếu thiếu thông tin then chốt hoặc trả sai
- Cho điểm full hoặc 0 — không partial cho SHORT (dùng MCQ/ORDERING nếu cần partial)

Trả JSON:
{
  "score": <0 hoặc ${question.points}>,
  "isCorrect": <true/false>,
  "feedback": "<1-2 câu giải thích, tiếng Việt>"
}`;

  const user = `Câu hỏi: ${question.prompt}

Đáp án chuẩn: ${correct}
${alts ? `Đáp án thay thế chấp nhận: ${alts}` : ''}

Câu trả lời của học sinh: ${answer}

Hãy chấm và trả JSON.`;

  try {
    const result = await routedGenerateText({
      useCase: 'reasoning',
      userId: ctx.userId,
      plan: ctx.plan,
      system,
      messages: [{ role: 'user', content: user }],
      maxOutputTokens: 300,
      feature: 'exam-grade-short',
      timeoutMs: 30_000,
      // Cache hit khi nhiều student trả cùng đáp án (vd "Hà Nội") — scope
      // shared vì grading rubric không user-specific. TTL 1h vì rubric đã
      // đóng (exam published → KHÔNG edit question)
      enableSemanticCache: true,
      cacheScope: 'shared',
      cacheTtlSec: 3600,
    });
    return parseGradingResponse(result.text, question.points);
  } catch (err) {
    logger.error('ai-grade-short.failed', {
      question_id: question.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      score: 0,
      isCorrect: false,
      feedback: 'AI chấm bài lỗi — đề nghị xem xét tay.',
      flaggedForReview: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Grade ESSAY với rubric multi-criterion.
 *
 * Rubric format jsonb:
 *   [
 *     { criterion: 'Nội dung', weight: 0.5, descriptors: { excellent: '...', good: '...', poor: '...' } },
 *     { criterion: 'Lập luận', weight: 0.3, ... },
 *     ...
 *   ]
 *
 * AI chấm từng criterion → tổng có trọng số. Trả breakdown cho UI hiển thị.
 */
export async function aiGradeEssay(
  question: ExamQuestion,
  answer: string,
  ctx: GradeContext,
): Promise<AiGradeResult> {
  if (!answer.trim()) {
    return { score: 0, isCorrect: false, feedback: 'Không có câu trả lời.' };
  }

  const rubric = question.rubric as
    | Array<{ criterion: string; weight: number; descriptors: Record<string, string> }>
    | null;

  // Không có rubric → fallback generic "đúng/sai" judgement
  if (!rubric || !Array.isArray(rubric) || rubric.length === 0) {
    return aiGradeShortAnswer(question, answer, ctx);
  }

  const rubricText = rubric
    .map(
      (r, i) =>
        `${i + 1}. ${r.criterion} (trọng số ${r.weight}):\n` +
        Object.entries(r.descriptors)
          .map(([k, v]) => `   - ${k}: ${v}`)
          .join('\n'),
    )
    .join('\n\n');

  const system = `Bạn là giám khảo chấm bài tự luận. Chấm theo rubric từng tiêu chí, mỗi tiêu chí 0..1 (1 = excellent).

Output JSON:
{
  "score": <tổng có trọng số × ${question.points}>,
  "isCorrect": <true nếu score >= ${question.points * 0.5}>,
  "feedback": "<3-5 câu phản hồi tổng thể, tiếng Việt>",
  "breakdown": { "<tên criterion>": <0..1> }
}

KHÔNG so sánh với đáp án chuẩn nếu không có. Chấm dựa rubric thuần.`;

  const user = `Câu hỏi: ${question.prompt}

Rubric chấm:
${rubricText}

Câu trả lời của học sinh:
${answer}

Hãy chấm theo rubric và trả JSON.`;

  try {
    const result = await routedGenerateText({
      useCase: 'reasoning',
      userId: ctx.userId,
      plan: ctx.plan,
      system,
      messages: [{ role: 'user', content: user }],
      maxOutputTokens: 800,
      feature: 'exam-grade-essay',
      timeoutMs: 45_000,
    });
    return parseGradingResponse(result.text, question.points);
  } catch (err) {
    logger.error('ai-grade-essay.failed', {
      question_id: question.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      score: 0,
      isCorrect: false,
      feedback: 'AI chấm bài lỗi — đề nghị xem xét tay.',
      flaggedForReview: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parse AI response JSON. Tolerant với markdown fence ```json...```.
 * Clamp score trong [0, maxPoints] để tránh AI hallucinate điểm âm/lớn hơn.
 */
function parseGradingResponse(text: string, maxPoints: number): AiGradeResult {
  // Strip markdown fence nếu có
  let json = text.trim();
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) json = fenceMatch[1]!.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      score: 0,
      isCorrect: false,
      feedback: 'AI trả về format không hợp lệ — đề nghị xem xét tay.',
      flaggedForReview: true,
      error: 'json-parse-failed',
    };
  }

  const result = RESPONSE_SCHEMA.safeParse(parsed);
  if (!result.success) {
    return {
      score: 0,
      isCorrect: false,
      feedback: 'AI thiếu trường bắt buộc — đề nghị xem xét tay.',
      flaggedForReview: true,
      error: 'schema-validation-failed',
    };
  }

  const clamped = Math.max(0, Math.min(maxPoints, result.data.score));
  return {
    score: clamped,
    isCorrect: result.data.isCorrect,
    feedback: result.data.feedback,
    breakdown: result.data.breakdown,
    flaggedForReview: result.data.flaggedForReview,
  };
}
