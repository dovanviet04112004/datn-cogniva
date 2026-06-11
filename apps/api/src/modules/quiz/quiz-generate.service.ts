import { Injectable } from '@nestjs/common';

import { CostGuardrailService, type Plan } from '../../infra/ai/cost-guardrail.service';
import { LlmService } from '../../infra/ai/llm.service';

export interface GenerateContext {
  userId: string;
  plan: Plan;
}

export type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'SHORT';

export type GeneratedQuestion =
  | {
      type: 'MCQ';
      prompt: string;
      options: string[];
      correctAnswer: number;
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
      correctAnswer: string;
      explanation: string;
      difficulty: number;
    };

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

function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Không tìm thấy JSON object trong output');
  return JSON.parse(match[0]);
}

function validateQuestion(raw: unknown): GeneratedQuestion | null {
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

@Injectable()
export class QuizGenerateService {
  constructor(
    private readonly llm: LlmService,
    private readonly guardrail: CostGuardrailService,
  ) {}

  async generateQuestions(
    content: string,
    types: QuestionType[],
    count: number,
    ctx: GenerateContext,
  ): Promise<GeneratedQuestion[]> {
    if (content.length < 80) return [];
    const userMessage = `LOẠI: ${types.join(', ')}\nSỐ CÂU: ${count}\n\nĐOẠN VĂN:\n"""\n${content}\n"""`;

    try {
      const guard = await this.guardrail.check({
        userId: ctx.userId,
        plan: ctx.plan,
        estimatedCostUsd: 0,
      });
      if (!guard.allowed) throw new Error(guard.message);

      const text = await this.llm.complete(userMessage, {
        system: INSTRUCTION_SYSTEM,
        maxTokens: 1200,
      });

      await this.guardrail.record({
        userId: ctx.userId,
        plan: ctx.plan,
        actualCostUsd: 0,
        model: 'llm-default',
        feature: 'quiz-gen',
      });

      const obj = extractJson(text) as { questions?: unknown };
      if (!Array.isArray(obj.questions)) return [];
      return obj.questions.map(validateQuestion).filter((q): q is GeneratedQuestion => q !== null);
    } catch (err) {
      console.warn('[quiz-generate] skip:', (err as Error).message);
      return [];
    }
  }
}
