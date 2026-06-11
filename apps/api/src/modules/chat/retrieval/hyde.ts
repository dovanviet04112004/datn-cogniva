/**
 * HyDE — Hypothetical Document Embeddings (Gao et al. 2022). Port từ
 * apps/web/src/lib/retrieval/hyde.ts.
 *
 * LLM sinh "câu trả lời giả định" 2-4 câu rồi embed CÂU TRẢ LỜI thay vì query
 * → vector gần với chunks chứa fact thực hơn (recall+precision tăng trên BEIR).
 *
 * KHÁC bản web (deviation có chủ đích): web dùng getChatModel() legacy bypass
 * router; bản Nest đi qua RouterService useCase 'ragChat' — chain primary
 * (anthropic sonnet → groq llama-3.3-70b) trùng pick order của getChatModel
 * nên model thực tế KHÔNG đổi, nhưng giờ có guardrail/circuit-breaker/cost
 * record. Router không expose temperature → temp 0.3 cũ bị bỏ.
 *
 * Failure mode giữ nguyên: LLM lỗi (kể cả guardrail deny) / empty / <20 chars
 * → fallback query gốc, không crash retrieval.
 */
import type { Plan } from '../../../infra/ai/cost-guardrail.service';
import type { RouterService } from '../../../infra/ai/router.service';

/** Prompt cố định để giảm variance — tránh LLM "diễn giải" yêu cầu. */
const HYDE_INSTRUCTION = `Bạn là trợ lý truy hồi tài liệu. Người dùng vừa hỏi một câu, hãy viết MỘT câu trả lời ngắn (2-4 câu, dạng đoạn văn liền mạch, không bullet, không heading) GIẢ ĐỊNH như tài liệu chứa câu trả lời. Nội dung phải đặc tả khái niệm + thuật ngữ kỹ thuật + chi tiết — vì câu trả lời này sẽ được embed để search vector. Không cần đúng tuyệt đối — đúng phong cách tài liệu là quan trọng. Trả lời cùng ngôn ngữ với câu hỏi.

Câu hỏi: `;

/**
 * Sinh hypothetical answer cho query để dùng làm input embedding.
 *
 * @returns Đoạn văn 2-4 câu giả định, hoặc query gốc nếu LLM lỗi
 */
export async function generateHypotheticalAnswer(
  router: RouterService,
  query: string,
  ctx: { userId: string; plan: Plan },
): Promise<string> {
  // Query rất ngắn (<8 ký tự) hoặc rất dài (>500) → skip HyDE
  if (query.length < 8 || query.length > 500) return query;

  try {
    const { text } = await router.routedGenerateText({
      useCase: 'ragChat',
      userId: ctx.userId,
      plan: ctx.plan,
      messages: [{ role: 'user', content: HYDE_INSTRUCTION + query }],
      // Limit token để nhanh + rẻ — 4 câu tiếng Việt ~150 token
      maxOutputTokens: 200,
      feature: 'hyde',
    });
    const trimmed = text.trim();
    // Một số free model trả empty hoặc echo lại prompt — phát hiện và fallback
    if (!trimmed || trimmed.length < 20) return query;
    return trimmed;
  } catch (err) {
    console.warn('[hyde] LLM call failed, fallback to original query:', err);
    return query;
  }
}
