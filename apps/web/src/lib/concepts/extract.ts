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

const EXTRACT_INSTRUCTION = `Bạn là chuyên gia trích xuất khái niệm cho hệ thống học tập. Đọc đoạn văn dưới đây và liệt kê 1-5 KHÁI NIỆM CÓ TÊN (named concept) mà đoạn này TRỰC TIẾP nói tới.

QUY TẮC:
- Chỉ lấy thuật ngữ chuyên ngành, tên định lý, tên thuật toán, tên người, tên hệ thống, tên công nghệ.
- BỎ QUA từ chung chung: "function", "system", "data", "method", "process" nếu chỉ dùng nghĩa thường.
- Nếu đoạn không có khái niệm có tên → trả mảng RỖNG.
- domain chọn 1 trong: "math", "cs", "physics", "biology", "chemistry", "history", "language", "business", "general".

ĐỊNH DẠNG OUTPUT — JSON THUẦN, KHÔNG markdown, KHÔNG backtick:
{"concepts": [{"name": "Tên ngắn", "description": "1 câu mô tả", "domain": "..."}]}

ĐOẠN VĂN:
"""
{{CONTENT}}
"""`;

export type ExtractedConcept = {
  name: string;
  description: string;
  domain: string;
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
  if (content.length < 50) return []; // chunk quá ngắn không có concept

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
      .map((c) => ({
        name: c.name.trim(),
        description: c.description.trim(),
        domain: c.domain.trim().toLowerCase(),
      }))
      .filter((c) => c.name.length > 0 && c.name.length < 100); // sane limit
  } catch (err) {
    console.warn('[extract-concepts] skip chunk:', (err as Error).message);
    return [];
  }
}
