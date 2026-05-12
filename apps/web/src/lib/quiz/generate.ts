/**
 * Quiz generator — LLM sinh câu hỏi MCQ / SHORT / TRUE_FALSE từ
 * chunks hoặc concept descriptions.
 *
 * Hỗ trợ 3 loại trong Phase 6 (TRUE_FALSE, MCQ, SHORT). FILL_BLANK đã có
 * cloze flashcard; ESSAY để sau (rubric grading phức tạp).
 *
 * Output JSON schema (chuẩn hoá giữa các loại):
 *   {
 *     questions: [
 *       { type: "MCQ"|"TRUE_FALSE"|"SHORT",
 *         prompt: string,
 *         options?: string[],
 *         correctAnswer: number|boolean|string,
 *         explanation: string,
 *         difficulty: number    // 0..1
 *       }
 *     ]
 *   }
 *
 * Đặc điểm difficulty:
 *   - MCQ "easy": chọn 1 fact đơn giản, distractor rõ ràng → 0.3
 *   - MCQ "medium": cần lập luận 1-2 bước, distractor giống nhau → 0.6
 *   - MCQ "hard": đòi tổng hợp nhiều mục, distractor lừa → 0.9
 *   LLM tự gán difficulty theo hướng dẫn.
 */
import { generateText } from 'ai';

import { getChatModel } from '@/lib/ai/models';
import { routedGenerateText } from '@/lib/ai/router';
import type { Plan } from '@/lib/observability/cost-guardrail';

/** Context tuỳ chọn — khi cung cấp, gen qua router (cost guardrail + cache + fallback). */
export interface GenerateContext {
  userId: string;
  plan: Plan;
}

/** Bộ loại quiz Phase 6 hỗ trợ. */
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

const INSTRUCTION = `Bạn là chuyên gia ra đề ôn tập. Đọc đoạn văn và sinh {{COUNT}} câu hỏi để học sinh kiểm tra hiểu biết.

LOẠI CÂU HỎI CHO PHÉP: {{TYPES}}

QUY TẮC:
- Tập trung vào CONCEPT cốt lõi (định nghĩa, nguyên lý, công thức, mối quan hệ), tránh hỏi chi tiết vụn vặt (số trang, tên tác giả không cốt lõi).
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
}

ĐOẠN VĂN:
"""
{{CONTENT}}
"""`;

/** Tách object JSON đầu tiên trong text (loại bỏ markdown fence). */
function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Không tìm thấy JSON object trong output');
  return JSON.parse(match[0]);
}

/** Validate 1 question raw → trả về object đã chuẩn hoá hoặc null nếu sai schema. */
function validateQuestion(raw: unknown): GeneratedQuestion | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const q = raw as Record<string, unknown>;
  const type = q.type;
  const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
  const explanation =
    typeof q.explanation === 'string' ? q.explanation.trim() : '';
  const difficulty =
    typeof q.difficulty === 'number'
      ? Math.max(0, Math.min(1, q.difficulty))
      : 0.5;
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
    return {
      type: 'TRUE_FALSE',
      prompt,
      correctAnswer: q.correctAnswer,
      explanation,
      difficulty,
    };
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

/**
 * Sinh câu hỏi từ 1 đoạn văn.
 * @param content - text gốc (nên 200-2000 ký tự)
 * @param types - loại câu hỏi cho phép (mặc định 3 loại)
 * @param count - số câu hỏi mong muốn (LLM có thể trả ít hơn)
 */
export async function generateQuestions(
  content: string,
  types: QuestionType[] = ['MCQ', 'TRUE_FALSE', 'SHORT'],
  count = 3,
  ctx?: GenerateContext,
): Promise<GeneratedQuestion[]> {
  if (content.length < 80) return [];
  const prompt = INSTRUCTION.replace('{{CONTENT}}', content)
    .replace('{{TYPES}}', types.join(', '))
    .replace('{{COUNT}}', String(count));

  try {
    let text: string;
    if (ctx) {
      // Router path — có cache + cost guardrail + fallback chain
      // Scope shared vì cùng chunk → cùng output (deterministic), không
      // user-specific. TTL 1h để cache hit cho user khác cùng đọc chunk này.
      const result = await routedGenerateText({
        useCase: 'quizGen',
        userId: ctx.userId,
        plan: ctx.plan,
        // Hệ thống prompt cố định (không có {{CONTENT}}/{{TYPES}}/{{COUNT}}) —
        // tách phần thay thế vào user message để cache key đúng theo content
        system: INSTRUCTION_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `LOẠI: ${types.join(', ')}\nSỐ CÂU: ${count}\n\nĐOẠN VĂN:\n"""\n${content}\n"""`,
          },
        ],
        maxOutputTokens: 1200,
        feature: 'quiz-gen',
        enableSemanticCache: true,
        cacheScope: 'shared',
        cacheTtlSec: 3600,
      });
      text = result.text;
    } else {
      // Legacy path — direct getChatModel(), không cache/router
      const result = await generateText({
        model: getChatModel(),
        prompt,
        temperature: 0.5,
        maxTokens: 1200,
      });
      text = result.text;
    }

    const obj = extractJson(text) as { questions?: unknown };
    if (!Array.isArray(obj.questions)) return [];
    return obj.questions
      .map(validateQuestion)
      .filter((q): q is GeneratedQuestion => q !== null);
  } catch (err) {
    console.warn('[quiz-generate] skip:', (err as Error).message);
    return [];
  }
}

/**
 * System prompt cố định cho router path — tách khỏi INSTRUCTION variable
 * để cache key build từ user message (chứa content) ổn định, không phụ
 * thuộc replace order.
 */
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
