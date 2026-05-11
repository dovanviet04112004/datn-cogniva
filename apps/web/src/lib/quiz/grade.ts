/**
 * Quiz grader — chấm điểm từng câu hỏi sau khi user submit.
 *
 * Quy ước score ∈ [0, 1]:
 *   - MCQ: 1.0 nếu khớp index, 0.0 nếu sai (binary).
 *   - TRUE_FALSE: 1.0 / 0.0 (binary).
 *   - SHORT: LLM so sánh userAnswer ↔ correctAnswer + explanation → 0..1.
 *
 * SHORT grading dùng LLM (chat model) thay vì cosine similarity vì:
 *   - User có thể paraphrase đúng ý nhưng từ ngữ khác → cosine fail.
 *   - LLM hiểu ngữ nghĩa + đánh giá độ đầy đủ.
 *   - Trade-off: chi phí cao hơn (1 LLM call/câu), nhưng chấp nhận cho quiz nhỏ.
 *
 * Failure mode:
 *   - LLM lỗi/trả invalid JSON → fallback score 0 + feedback "Không chấm được, thử lại".
 *   - Empty userAnswer → score 0 ngay không gọi LLM.
 */
import { generateText } from 'ai';

import { getChatModel } from '@/lib/ai/models';

/** Kết quả chấm 1 câu. */
export type GradeResult = {
  score: number; // 0..1
  /** Feedback ngắn cho user — gồm correctness + gợi ý nếu sai. */
  feedback: string;
};

/** Chấm MCQ: index của user khớp index correctAnswer. */
export function gradeMcq(userAnswer: number, correctAnswer: number): GradeResult {
  const correct = userAnswer === correctAnswer;
  return {
    score: correct ? 1 : 0,
    feedback: correct ? 'Chính xác.' : 'Sai đáp án.',
  };
}

/** Chấm TRUE/FALSE: boolean khớp. */
export function gradeTrueFalse(
  userAnswer: boolean,
  correctAnswer: boolean,
): GradeResult {
  const correct = userAnswer === correctAnswer;
  return {
    score: correct ? 1 : 0,
    feedback: correct ? 'Chính xác.' : 'Sai đáp án.',
  };
}

const SHORT_GRADE_INSTRUCTION = `Bạn là giáo viên chấm bài. So sánh câu trả lời của học sinh với đáp án mẫu, cho điểm 0.0 → 1.0 theo độ chính xác và độ đầy đủ.

QUY TẮC:
- 1.0: trả lời đúng, đủ ý chính.
- 0.6-0.9: đúng ý chính nhưng thiếu chi tiết.
- 0.3-0.5: hiểu sai một phần hoặc bỏ sót nhiều ý.
- 0.0-0.2: sai hoàn toàn hoặc lạc đề.
- Ngôn từ khác đáp án mẫu KHÔNG bị trừ điểm, miễn ý đúng.
- Trả feedback NGẮN (1-2 câu) bằng cùng ngôn ngữ với câu hỏi.

ĐỊNH DẠNG OUTPUT — JSON THUẦN, KHÔNG MARKDOWN:
{"score": 0.85, "feedback": "..."}

CÂU HỎI: {{PROMPT}}

ĐÁP ÁN MẪU: {{CORRECT}}

CÂU TRẢ LỜI CỦA HỌC SINH: {{USER}}`;

/** Tách JSON object đầu tiên (bỏ markdown). */
function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Không tìm thấy JSON');
  return JSON.parse(match[0]);
}

/** Chấm câu SHORT bằng LLM. */
export async function gradeShort(
  prompt: string,
  correctAnswer: string,
  userAnswer: string,
): Promise<GradeResult> {
  if (!userAnswer.trim()) {
    return { score: 0, feedback: 'Chưa trả lời.' };
  }
  try {
    const { text } = await generateText({
      model: getChatModel(),
      prompt: SHORT_GRADE_INSTRUCTION.replace('{{PROMPT}}', prompt)
        .replace('{{CORRECT}}', correctAnswer)
        .replace('{{USER}}', userAnswer),
      temperature: 0.2,
      maxTokens: 200,
    });
    const obj = extractJson(text) as { score?: unknown; feedback?: unknown };
    const rawScore = typeof obj.score === 'number' ? obj.score : 0;
    const score = Math.max(0, Math.min(1, rawScore));
    const feedback =
      typeof obj.feedback === 'string' && obj.feedback.trim()
        ? obj.feedback.trim()
        : 'Đã chấm.';
    return { score, feedback };
  } catch (err) {
    console.warn('[grade-short] fallback:', (err as Error).message);
    return { score: 0, feedback: 'Không chấm được, hãy thử lại.' };
  }
}
