/**
 * Concept extraction — LLM scan từng chunk → list khái niệm chuyên ngành
 * (thuật ngữ, định lý, tên hệ thống, tên người, …) mà chunk đề cập đến.
 *
 * Input: 1 chunk content
 * Output: { concepts: [{ name, description, domain }] }
 *
 * Vì sao 1 chunk/call (không batch):
 *   - Free model JSON output dễ vỡ khi response dài (5-10 chunks/batch).
 *   - Latency mỗi chunk ~0.5-1s không quá chậm cho 100-200 chunks (offline job).
 *   - Cost trên Anthropic Haiku ~$0.0001/chunk → 1000 chunks ~$0.10. OK.
 *
 * Vì sao chỉ extract "named concept", bỏ qua từ chung?
 *   - Từ chung (function, system, data, ...) không có giá trị graph.
 *   - Concept graph chỉ có ý nghĩa khi đại diện thuật ngữ user cần học.
 *
 * Failure mode:
 *   - LLM trả invalid JSON → catch → return [] cho chunk đó (không crash batch).
 *   - LLM trả empty → cũng [] (chunk có thể là intro/figure caption không học thuật).
 */
import { generateText } from 'ai';

import { getChatModel } from '@/lib/ai/models';

/**
 * Atom-centric prompt (sau Phase A6): mỗi atom extract ra KÈM examples,
 * difficulty, preview Q/A để dùng độc lập ở UI (atom detail card) và làm
 * input cho flashcard/quiz/exam generation downstream.
 *
 * Trade-off: prompt dài hơn ~20% tokens, nhưng tránh được 2 lần gọi LLM
 * (extract concept + sau đó gen flashcard). 1 prompt giải quyết cả 2.
 */
const EXTRACT_INSTRUCTION = `Bạn là chuyên gia trích xuất ATOM kiến thức (đơn vị học tập tối thiểu) cho hệ thống học tập. Đọc đoạn văn dưới đây và liệt kê 1-5 ATOM CÓ TÊN mà đoạn này TRỰC TIẾP nói tới.

QUY TẮC:
- Chỉ lấy thuật ngữ chuyên ngành, tên định lý, tên thuật toán, tên người, tên hệ thống, tên công nghệ.
- BỎ QUA từ chung chung: "function", "system", "data", "method", "process" nếu chỉ dùng nghĩa thường.
- Nếu đoạn không có atom có tên → trả mảng RỖNG.
- domain chọn 1 trong: "math", "cs", "physics", "biology", "chemistry", "history", "language", "business", "general".
- difficulty: 0..1 (0 dễ phổ thông, 0.5 trung học, 0.8 chuyên ngành, 1 nghiên cứu).
- strength: 0..1 — đoạn văn nói về atom này MẠNH cỡ nào (1 = chủ đề CHÍNH của đoạn, 0.5 = nói khá rõ, 0.3 = chỉ nhắc thoáng qua).
- examples: 1-3 ví dụ NGẮN (mỗi cái <100 ký tự). Có thể rỗng nếu khái niệm trừu tượng.
- previewQuestion + previewAnswer: 1 câu hỏi ngắn + đáp án để hiển thị "atom này là gì". Câu hỏi tự nhiên, không "Định nghĩa X là gì".

ĐỊNH DẠNG OUTPUT — JSON THUẦN, KHÔNG markdown, KHÔNG backtick:
{"concepts": [{"name": "Tên ngắn", "description": "1 câu mô tả", "domain": "...", "difficulty": 0.5, "strength": 0.8, "examples": ["ex1", "ex2"], "previewQuestion": "...", "previewAnswer": "..."}]}

ĐOẠN VĂN:
"""
{{CONTENT}}
"""`;

export type ExtractedConcept = {
  name: string;
  description: string;
  domain: string;
  /** Phase A6: optional vì cache cũ có thể thiếu — code path forward-compat. */
  difficulty?: number;
  /** Độ liên quan của chunk này tới atom (0..1) → lưu chunk_concept.strength. */
  strength?: number;
  examples?: string[];
  previewQuestion?: string;
  previewAnswer?: string;
};

/** Strip code fence + extract object JSON đầu tiên. */
function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  // Tìm đoạn { ... } đầu tiên — phòng LLM trả thêm prose
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in LLM output');
  return JSON.parse(match[0]);
}

/**
 * Trích concept từ 1 chunk content. Trả mảng rỗng khi LLM lỗi/empty —
 * chunk đó skip silent thay vì crash batch.
 *
 * @param ctx - Khi cung cấp, dùng router (cache + cost guardrail + fallback).
 *              Cùng content → cùng concepts (deterministic) → cache hit shared.
 */
export async function extractConceptsFromChunk(
  content: string,
  ctx?: { userId: string; plan: import('@/lib/observability/cost-guardrail').Plan },
): Promise<ExtractedConcept[]> {
  // Chunk quá ngắn (tiêu đề/caption) → skip extract. Hạ ngưỡng 50→30 để không
  // bỏ sót thuật ngữ ngắn (vd "Định lý Pythagoras" ~19 ký tự vẫn là 1 chunk dài
  // hơn 30 khi kèm ngữ cảnh); <30 thường là rác/số trang.
  if (content.length < 30) return [];

  try {
    let text: string;
    if (ctx) {
      const { routedGenerateText } = await import('@/lib/ai/router');
      const result = await routedGenerateText({
        useCase: 'classify',
        userId: ctx.userId,
        plan: ctx.plan,
        system: EXTRACT_INSTRUCTION.split('{{CONTENT}}')[0]!.trim(),
        messages: [{ role: 'user', content: `ĐOẠN VĂN:\n"""\n${content}\n"""` }],
        maxOutputTokens: 500,
        feature: 'concept-extract',
        enableSemanticCache: true,
        cacheScope: 'shared',
        cacheTtlSec: 86400, // 24h — concept extraction deterministic, có thể cache dài
      });
      text = result.text;
    } else {
      const result = await generateText({
        model: getChatModel(),
        prompt: EXTRACT_INSTRUCTION.replace('{{CONTENT}}', content),
        temperature: 0.2,
        maxTokens: 500,
      });
      text = result.text;
    }
    const obj = extractJson(text) as { concepts?: unknown };
    if (!Array.isArray(obj.concepts)) return [];
    return obj.concepts
      .filter(
        (c): c is ExtractedConcept =>
          typeof (c as ExtractedConcept)?.name === 'string' &&
          typeof (c as ExtractedConcept)?.description === 'string' &&
          typeof (c as ExtractedConcept)?.domain === 'string',
      )
      .map((c) => {
        // Sanitize optional fields — LLM có thể trả thiếu, sai type, hoặc null.
        const raw = c as Record<string, unknown>;
        const examples = Array.isArray(raw.examples)
          ? (raw.examples as unknown[])
              .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
              .slice(0, 3)
              .map((s) => s.trim().slice(0, 200))
          : undefined;
        const difficulty =
          typeof raw.difficulty === 'number' && raw.difficulty >= 0 && raw.difficulty <= 1
            ? raw.difficulty
            : undefined;
        const strength =
          typeof raw.strength === 'number' && raw.strength >= 0 && raw.strength <= 1
            ? raw.strength
            : undefined;
        const previewQuestion =
          typeof raw.previewQuestion === 'string' && raw.previewQuestion.trim().length > 0
            ? raw.previewQuestion.trim().slice(0, 300)
            : undefined;
        const previewAnswer =
          typeof raw.previewAnswer === 'string' && raw.previewAnswer.trim().length > 0
            ? raw.previewAnswer.trim().slice(0, 500)
            : undefined;
        return {
          name: c.name.trim(),
          description: c.description.trim(),
          domain: c.domain.trim().toLowerCase(),
          examples,
          difficulty,
          strength,
          previewQuestion,
          previewAnswer,
        };
      })
      .filter((c) => c.name.length > 0 && c.name.length < 100); // sane limit
  } catch (err) {
    console.warn('[extract-concepts] skip chunk:', (err as Error).message);
    return [];
  }
}
