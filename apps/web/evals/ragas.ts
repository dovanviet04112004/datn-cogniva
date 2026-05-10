/**
 * RAGAS-style metrics — đánh giá RAG bằng LLM-as-judge.
 *
 * Triển khai 4 metric (3 RAGAS chuẩn + 1 recall đối chiếu ground truth chunk):
 *
 *   1. faithfulness        — Câu trả lời có grounded trong context không?
 *      (1 = mọi claim suy ra được từ context, 0 = bịa hoàn toàn)
 *
 *   2. answer_relevancy    — Câu trả lời có đúng ý câu hỏi không?
 *      (1 = trả lời đầy đủ, 0 = lạc đề)
 *
 *   3. context_relevancy   — Context retrieved có liên quan câu hỏi không?
 *      (1 = mọi chunk đều dùng được, 0 = noise)
 *
 *   4. context_recall      — Source chunk gốc có trong top-K không?
 *      (1 = có, 0 = không) — không phải RAGAS chuẩn nhưng quan trọng vì ta
 *      có ground truth chunk_id, đo trực tiếp khả năng find lại.
 *
 * Vì sao LLM-as-judge?
 *   - Faithfulness/relevancy là semantic, không metric numeric đơn thuần.
 *   - GPT-4 / Claude làm tốt vai trò judge với prompt structured.
 *
 * Trade-off:
 *   - Tốn token: 3 LLM call/turn × 100 turn = 300 calls. Free tier OK.
 *   - LLM judge có bias — nên dùng cùng model cho cả basic & advanced để
 *     bias triệt tiêu khi so sánh delta.
 *
 * Caveat: judge prompt giữ ngắn để giảm cost. Phase 4 có thể nâng lên
 * statement-level RAGAS (split answer thành claims, judge từng claim).
 */
import { generateText } from 'ai';

import { getChatModel } from '../src/lib/ai/models';

const FAITHFULNESS_PROMPT = `Bạn là chuyên gia đánh giá RAG. Cho:
- CÂU TRẢ LỜI: do AI sinh từ context được retrieve.
- CONTEXT: các đoạn văn đã retrieve.

Hãy chấm faithfulness — liệu MỌI claim trong câu trả lời có suy ra được từ context không?
- 1.0: tất cả claims đều có support trong context
- 0.5: 1 phần claims có support, 1 phần bịa/ngoại suy
- 0.0: hầu hết claims không có trong context

Trả về JSON THUẦN: {"score": <0..1>, "reasoning": "..."}

CONTEXT:
{{CONTEXT}}

CÂU TRẢ LỜI:
{{ANSWER}}`;

const ANSWER_RELEVANCY_PROMPT = `Bạn là chuyên gia đánh giá QA. Cho:
- CÂU HỎI gốc của user.
- CÂU TRẢ LỜI do AI sinh.

Hãy chấm answer_relevancy — câu trả lời có đúng ý câu hỏi và đầy đủ không?
- 1.0: trả lời thẳng, đầy đủ, không lạc
- 0.5: liên quan nhưng thiếu/lan man
- 0.0: lạc đề hoàn toàn

Trả về JSON THUẦN: {"score": <0..1>, "reasoning": "..."}

CÂU HỎI:
{{QUESTION}}

CÂU TRẢ LỜI:
{{ANSWER}}`;

const CONTEXT_RELEVANCY_PROMPT = `Bạn là chuyên gia đánh giá retrieval. Cho:
- CÂU HỎI của user.
- CONTEXT: các chunks đã retrieve.

Hãy ước lượng context_relevancy — TỈ LỆ chunks trong context thực sự liên quan câu hỏi.
- 1.0: 100% chunks đều liên quan/giúp trả lời
- 0.5: ~50% chunks liên quan, còn lại là noise
- 0.0: không chunk nào liên quan

Trả về JSON THUẦN: {"score": <0..1>, "reasoning": "..."}

CÂU HỎI:
{{QUESTION}}

CONTEXT:
{{CONTEXT}}`;

/** Strip code fence + parse JSON đầu tiên — copy của golden-build cho self-contained. */
function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in LLM judge output');
  return JSON.parse(match[0]);
}

async function judge(prompt: string): Promise<number> {
  try {
    const { text } = await generateText({
      model: getChatModel(),
      prompt,
      temperature: 0,
      maxTokens: 200,
    });
    const obj = extractJson(text) as { score?: unknown };
    const score = Number(obj.score);
    if (Number.isFinite(score) && score >= 0 && score <= 1) return score;
    return 0;
  } catch (err) {
    console.warn('[ragas] judge failed:', (err as Error).message);
    return 0;
  }
}

/** Format chunks thành text cho judge đọc. */
function formatContext(chunks: { content: string }[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] ${c.content}`)
    .join('\n\n---\n\n');
}

export async function judgeFaithfulness(
  answer: string,
  contextChunks: { content: string }[],
): Promise<number> {
  const prompt = FAITHFULNESS_PROMPT.replace('{{CONTEXT}}', formatContext(contextChunks)).replace(
    '{{ANSWER}}',
    answer,
  );
  return judge(prompt);
}

export async function judgeAnswerRelevancy(
  question: string,
  answer: string,
): Promise<number> {
  const prompt = ANSWER_RELEVANCY_PROMPT.replace('{{QUESTION}}', question).replace(
    '{{ANSWER}}',
    answer,
  );
  return judge(prompt);
}

export async function judgeContextRelevancy(
  question: string,
  contextChunks: { content: string }[],
): Promise<number> {
  const prompt = CONTEXT_RELEVANCY_PROMPT.replace('{{QUESTION}}', question).replace(
    '{{CONTEXT}}',
    formatContext(contextChunks),
  );
  return judge(prompt);
}

/** context_recall = source chunk gốc có trong retrieved chunks không (binary). */
export function computeContextRecall(
  sourceChunkId: string,
  retrievedIds: string[],
): number {
  return retrievedIds.includes(sourceChunkId) ? 1 : 0;
}
