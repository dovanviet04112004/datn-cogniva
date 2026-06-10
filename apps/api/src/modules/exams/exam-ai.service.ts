/**
 * ExamAiService — mọi LLM call của exams module:
 *   1. generateQuestions — sinh câu hỏi từ chunk (port apps/web/src/lib/quiz/generate.ts,
 *      prompt nguyên văn, router path).
 *   2. aiGradeShortAnswer / aiGradeEssay — chấm SHORT semantic + ESSAY rubric
 *      (port apps/web/src/lib/ai/grade-essay.ts, prompt nguyên văn).
 *
 * Cost guardrail: route cũ đi qua routedGenerateText (check trước / record sau).
 * apps/api không có router — guardedComplete() tự check/record quanh LlmService.
 * Lệch chấp nhận so với router cũ (ghi chú để Wave sau nối):
 *   - Estimate/record giá theo model LlmService THẬT SỰ gọi (Groq free = $0;
 *     Anthropic = Sonnet) thay vì primary tĩnh của route (reasoning cũ = Opus).
 *   - LlmService không trả usage tokens → ước lượng 1 token ≈ 3 chars như
 *     estimateInputTokens cũ. Provider thực tế Groq free → cost 0, record tự skip.
 *   - Không có semantic cache + per-call timeout (router-only features).
 */
import { Injectable } from '@nestjs/common';
import type { exam_question as ExamQuestionRow } from '@prisma/client';
import { z } from 'zod';
import { logger } from '@cogniva/server-core';

import { CostGuardrailService, type Plan } from '../../infra/ai/cost-guardrail.service';
import { LlmService } from '../../infra/ai/llm.service';

export interface GradeContext {
  userId: string;
  plan: Plan;
}

export interface AiGradeResult {
  score: number;
  isCorrect: boolean;
  feedback: string;
  /** Map criterion → score (chỉ có với ESSAY rubric). */
  breakdown?: Record<string, number>;
  /** Phase 18 — map criterion → confidence (0..1). Confidence < 0.6 auto flag review. */
  confidence?: Record<string, number>;
  /** Phase 18 — actionable feedback: điểm mạnh + đề xuất cải thiện. */
  strengths?: string[];
  improvements?: string[];
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
  confidence: z.record(z.string(), z.number()).optional(),
  strengths: z.array(z.string()).optional(),
  improvements: z.array(z.string()).optional(),
  flaggedForReview: z.boolean().optional(),
});

/** Threshold confidence để auto-flag review. Phase 18 V1 dùng 0.6. */
const CONFIDENCE_REVIEW_THRESHOLD = 0.6;

/** Bộ loại quiz generator hỗ trợ (map sang exam type ở ExamsService). */
export type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'SHORT';

export type GeneratedQuestion =
  | {
      type: 'MCQ';
      prompt: string;
      options: string[];
      correctAnswer: number; // index 0-based
      explanation: string;
      difficulty: number;
    }
  | {
      type: 'TRUE_FALSE';
      prompt: string;
      correctAnswer: boolean;
      explanation: string;
      difficulty: number;
    }
  | {
      type: 'SHORT';
      prompt: string;
      /** Câu trả lời mẫu — đối chiếu khi grading. */
      correctAnswer: string;
      explanation: string;
      difficulty: number;
    };

// ── System prompt quiz gen — copy NGUYÊN VĂN INSTRUCTION_SYSTEM (router path)
//    từ apps/web/src/lib/quiz/generate.ts ────────────────────────────────────
const INSTRUCTION_SYSTEM = `Bạn là chuyên gia ra đề ôn tập. Đọc đoạn văn và sinh số câu hỏi yêu cầu để học sinh kiểm tra hiểu biết.

QUY TẮC:
- Tập trung vào CONCEPT cốt lõi (định nghĩa, nguyên lý, công thức, mối quan hệ), tránh hỏi chi tiết vụn vặt.
- Tránh trùng nội dung giữa các câu.
- Đa dạng độ khó: easy=0.3, medium=0.6, hard=0.85. Cố gắng phủ cả 3 mức.
- Trả lời CÙNG NGÔN NGỮ với đoạn văn.

LOẠI MCQ: tạo đúng 4 lựa chọn, ĐÁP ÁN ĐÚNG chỉ 1; correctAnswer là CHỈ SỐ 0-3.
LOẠI TRUE_FALSE: prompt là 1 mệnh đề; correctAnswer là true hoặc false.
LOẠI SHORT: prompt là 1 câu hỏi mở; correctAnswer là câu trả lời mẫu 1-3 câu (sẽ dùng làm tham chiếu chấm điểm AI).

MỖI CÂU PHẢI CÓ "explanation" 1-2 câu giải thích vì sao đáp án đó đúng.

ĐỊNH DẠNG OUTPUT — JSON THUẦN, KHÔNG MARKDOWN, KHÔNG BACKTICK:
{
  "questions": [
    {"type": "MCQ", "prompt": "...", "options": ["a","b","c","d"], "correctAnswer": 0, "explanation": "...", "difficulty": 0.3},
    {"type": "TRUE_FALSE", "prompt": "...", "correctAnswer": true, "explanation": "...", "difficulty": 0.5},
    {"type": "SHORT", "prompt": "...", "correctAnswer": "...", "explanation": "...", "difficulty": 0.8}
  ]
}`;

@Injectable()
export class ExamAiService {
  constructor(
    private readonly llm: LlmService,
    private readonly guardrails: CostGuardrailService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Quiz generator (cho POST /exams/:id/generate-questions)
  // ──────────────────────────────────────────────────────────

  /**
   * Sinh câu hỏi từ 1 đoạn văn. Lỗi (kể cả guardrail chặn) → trả [] như
   * generateQuestions cũ (caller gom đủ 0 câu sẽ trả 500 'AI không sinh được câu hỏi').
   */
  async generateQuestions(
    content: string,
    types: QuestionType[],
    count: number,
    ctx: GradeContext,
  ): Promise<GeneratedQuestion[]> {
    if (content.length < 80) return [];

    const userMsg = `LOẠI: ${types.join(', ')}\nSỐ CÂU: ${count}\n\nĐOẠN VĂN:\n"""\n${content}\n"""`;

    try {
      const text = await this.guardedComplete({
        ...ctx,
        system: INSTRUCTION_SYSTEM,
        prompt: userMsg,
        maxTokens: 1200,
        feature: 'quiz-gen',
      });
      const obj = this.extractJson(text) as { questions?: unknown };
      if (!Array.isArray(obj.questions)) return [];
      return obj.questions
        .map((raw) => this.validateQuestion(raw))
        .filter((q): q is GeneratedQuestion => q !== null);
    } catch (err) {
      console.warn('[quiz-generate] skip:', (err as Error).message);
      return [];
    }
  }

  /** Tách object JSON đầu tiên trong text (loại bỏ markdown fence). */
  private extractJson(text: string): unknown {
    const stripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Không tìm thấy JSON object trong output');
    return JSON.parse(match[0]);
  }

  /** Validate 1 question raw → object chuẩn hoá hoặc null nếu sai schema. */
  private validateQuestion(raw: unknown): GeneratedQuestion | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const q = raw as Record<string, unknown>;
    const type = q.type;
    const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';
    const difficulty =
      typeof q.difficulty === 'number' ? Math.max(0, Math.min(1, q.difficulty)) : 0.5;
    if (!prompt || !explanation) return null;

    if (type === 'MCQ') {
      if (!Array.isArray(q.options) || q.options.length < 2) return null;
      const options = q.options.filter((o): o is string => typeof o === 'string');
      if (options.length < 2) return null;
      const correct = q.correctAnswer;
      if (typeof correct !== 'number' || correct < 0 || correct >= options.length) {
        return null;
      }
      return {
        type: 'MCQ',
        prompt,
        options,
        correctAnswer: Math.floor(correct),
        explanation,
        difficulty,
      };
    }

    if (type === 'TRUE_FALSE') {
      if (typeof q.correctAnswer !== 'boolean') return null;
      return { type: 'TRUE_FALSE', prompt, correctAnswer: q.correctAnswer, explanation, difficulty };
    }

    if (type === 'SHORT') {
      if (typeof q.correctAnswer !== 'string' || !q.correctAnswer.trim()) {
        return null;
      }
      return {
        type: 'SHORT',
        prompt,
        correctAnswer: q.correctAnswer.trim(),
        explanation,
        difficulty,
      };
    }

    return null;
  }

  // ──────────────────────────────────────────────────────────
  // AI grading (SHORT semantic + ESSAY rubric)
  // ──────────────────────────────────────────────────────────

  /**
   * Grade SHORT question — semantic equivalence check. Khi user trả "Đạo hàm
   * của sin x là cos x", correctAnswer = "cos(x)" → AI decide accept hay không.
   */
  async aiGradeShortAnswer(
    question: ExamQuestionRow,
    answer: string,
    ctx: GradeContext,
  ): Promise<AiGradeResult> {
    if (!answer.trim()) {
      return { score: 0, isCorrect: false, feedback: 'Không có câu trả lời.' };
    }

    const correct =
      typeof question.correct_answer === 'string'
        ? question.correct_answer
        : JSON.stringify(question.correct_answer);
    const alts = ((question.acceptable_answers as string[] | null) ?? []).join(' | ');

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
      const text = await this.guardedComplete({
        ...ctx,
        system,
        prompt: user,
        maxTokens: 300,
        feature: 'exam-grade-short',
      });
      return this.parseGradingResponse(text, question.points);
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
   * Grade ESSAY với rubric multi-criterion (jsonb [{criterion, weight, descriptors}]).
   * Không có rubric → fallback aiGradeShortAnswer (generic judgement).
   */
  async aiGradeEssay(
    question: ExamQuestionRow,
    answer: string,
    ctx: GradeContext,
  ): Promise<AiGradeResult> {
    if (!answer.trim()) {
      return { score: 0, isCorrect: false, feedback: 'Không có câu trả lời.' };
    }

    const rubric = question.rubric as
      | Array<{ criterion: string; weight: number; descriptors: Record<string, string> }>
      | null;

    if (!rubric || !Array.isArray(rubric) || rubric.length === 0) {
      return this.aiGradeShortAnswer(question, answer, ctx);
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

Phase 18 yêu cầu thêm:
- confidence per criterion (0..1): bạn TỰ TIN bao nhiêu về điểm của tiêu chí đó. Confidence < 0.6 = đề nghị giáo viên xem lại.
- strengths: 2-3 điểm mạnh cụ thể trong bài (trích đoạn ngắn nếu có thể).
- improvements: 2-3 đề xuất cải thiện cụ thể, actionable.

Output JSON:
{
  "score": <tổng có trọng số × ${question.points}>,
  "isCorrect": <true nếu score >= ${question.points * 0.5}>,
  "feedback": "<3-5 câu phản hồi tổng thể, tiếng Việt>",
  "breakdown": { "<tên criterion>": <0..1> },
  "confidence": { "<tên criterion>": <0..1> },
  "strengths": ["<điểm mạnh 1>", "<điểm mạnh 2>"],
  "improvements": ["<đề xuất 1>", "<đề xuất 2>"]
}

KHÔNG so sánh với đáp án chuẩn nếu không có. Chấm dựa rubric thuần.`;

    const user = `Câu hỏi: ${question.prompt}

Rubric chấm:
${rubricText}

Câu trả lời của học sinh:
${answer}

Hãy chấm theo rubric và trả JSON.`;

    try {
      const text = await this.guardedComplete({
        ...ctx,
        system,
        prompt: user,
        maxTokens: 800,
        feature: 'exam-grade-essay',
      });
      return this.parseGradingResponse(text, question.points);
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
  private parseGradingResponse(text: string, maxPoints: number): AiGradeResult {
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

    // Auto-flag review nếu confidence thấp ở bất kỳ tiêu chí nào — owner phải xem lại
    let autoFlag = result.data.flaggedForReview ?? false;
    if (result.data.confidence) {
      const lowConfidence = Object.values(result.data.confidence).some(
        (c) => c < CONFIDENCE_REVIEW_THRESHOLD,
      );
      if (lowConfidence) autoFlag = true;
    }

    return {
      score: clamped,
      isCorrect: result.data.isCorrect,
      feedback: result.data.feedback,
      breakdown: result.data.breakdown,
      confidence: result.data.confidence,
      strengths: result.data.strengths,
      improvements: result.data.improvements,
      flaggedForReview: autoFlag,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Guarded LLM call — check guardrail trước / record sau
  // ──────────────────────────────────────────────────────────

  /** Throw Error(guard.message) khi bị chặn — caller catch như CostGuardrailError cũ. */
  private async guardedComplete(args: {
    userId: string;
    plan: Plan;
    system: string;
    prompt: string;
    maxTokens: number;
    feature: string;
  }): Promise<string> {
    const pm = this.pickModelForCost();
    // Heuristic estimateInputTokens cũ: 1 token ≈ 3 chars (an toàn cho tiếng Việt).
    const inputTokens = Math.ceil((args.system.length + args.prompt.length) / 3);
    const estimatedCostUsd =
      (inputTokens * pm.inputPerM + args.maxTokens * pm.outputPerM) / 1_000_000;

    const guard = await this.guardrails.check({
      userId: args.userId,
      plan: args.plan,
      estimatedCostUsd,
    });
    if (!guard.allowed) throw new Error(guard.message);

    const started = Date.now();
    const text = await this.llm.complete(args.prompt, {
      system: args.system,
      maxTokens: args.maxTokens,
    });

    // LlmService không expose usage → xấp xỉ output bằng độ dài text.
    const outputTokens = Math.ceil(text.length / 3);
    await this.guardrails.record({
      userId: args.userId,
      plan: args.plan,
      actualCostUsd: (inputTokens * pm.inputPerM + outputTokens * pm.outputPerM) / 1_000_000,
      model: pm.model,
      provider: pm.provider,
      feature: args.feature,
      tokensIn: inputTokens,
      tokensOut: outputTokens,
      latencyMs: Date.now() - started,
    });

    return text;
  }

  /**
   * Model + giá ($/1M tokens) ứng với provider LlmService sẽ pick.
   * NGUỒN CHUẨN pick order ở src/infra/ai/llm.service.ts — đổi thì sửa cả 2.
   * Giá free-tier (groq/google/openrouter) = 0 như bảng PROVIDERS router cũ.
   */
  private pickModelForCost(): {
    provider: string;
    model: string;
    inputPerM: number;
    outputPerM: number;
  } {
    const forced = process.env.LLM_PROVIDER;
    const provider =
      forced && ['anthropic', 'openrouter', 'groq', 'google'].includes(forced)
        ? forced
        : process.env.ANTHROPIC_API_KEY
          ? 'anthropic'
          : process.env.GROQ_API_KEY
            ? 'groq'
            : process.env.GOOGLE_GENERATIVE_AI_API_KEY
              ? 'google'
              : 'openrouter';

    switch (provider) {
      case 'anthropic':
        return { provider, model: 'claude-sonnet-4-6', inputPerM: 3, outputPerM: 15 };
      case 'groq':
        return { provider, model: 'llama-3.3-70b-versatile', inputPerM: 0, outputPerM: 0 };
      case 'google':
        return { provider, model: 'gemini-2.5-flash', inputPerM: 0, outputPerM: 0 };
      default:
        return { provider: 'openrouter', model: 'openai/gpt-oss-20b:free', inputPerM: 0, outputPerM: 0 };
    }
  }
}
