/**
 * HyDE — Hypothetical Document Embeddings (Gao et al. 2022).
 *
 * Ý tưởng:
 *   - Query gốc của user thường ngắn ("quang hợp là gì") — không có nhiều
 *     keyword/context để embedding align với các chunk dài.
 *   - Cho LLM sinh ra một "câu trả lời giả định" 2-3 câu rồi embed CÂU TRẢ
 *     LỜI thay vì query → vector gần với chunks chứa fact thực hơn.
 *   - Trade-off: thêm 1 LLM call (~300-500ms + cost), nhưng recall+precision
 *     tăng đáng kể trên benchmark BEIR.
 *
 * Tại sao no streaming?
 *   - Cần text full để embed; streaming chỉ tốt cho UX, ở đây là internal.
 *   - generateText sync gọn hơn streamText → đợi promise.
 *
 * Failure mode:
 *   - LLM rate limit / timeout → catch error, return query gốc + log warning.
 *   - Empty hypothetical → cũng fallback (1 số free model thi thoảng trả "").
 */
import { generateText } from 'ai';

import { getChatModel } from '@/lib/ai/models';

/** Prompt cố định để giảm variance — tránh LLM "diễn giải" yêu cầu. */
const HYDE_INSTRUCTION = `Bạn là trợ lý truy hồi tài liệu. Người dùng vừa hỏi một câu, hãy viết MỘT câu trả lời ngắn (2-4 câu, dạng đoạn văn liền mạch, không bullet, không heading) GIẢ ĐỊNH như tài liệu chứa câu trả lời. Nội dung phải đặc tả khái niệm + thuật ngữ kỹ thuật + chi tiết — vì câu trả lời này sẽ được embed để search vector. Không cần đúng tuyệt đối — đúng phong cách tài liệu là quan trọng. Trả lời cùng ngôn ngữ với câu hỏi.

Câu hỏi: `;

/**
 * Sinh hypothetical answer cho query để dùng làm input embedding.
 *
 * @param query - Câu hỏi gốc của user
 * @returns Đoạn văn 2-4 câu giả định, hoặc query gốc nếu LLM lỗi
 */
export async function generateHypotheticalAnswer(query: string): Promise<string> {
  // Query rất ngắn (<8 ký tự) hoặc rất dài (>500) → skip HyDE
  // Quá ngắn = LLM không có context để mở rộng
  // Quá dài = đã rich keyword, HyDE không thêm giá trị
  if (query.length < 8 || query.length > 500) return query;

  try {
    const { text } = await generateText({
      model: getChatModel(),
      prompt: HYDE_INSTRUCTION + query,
      // Limit token để nhanh + rẻ — 4 câu tiếng Việt ~150 token
      maxTokens: 200,
      temperature: 0.3,
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
