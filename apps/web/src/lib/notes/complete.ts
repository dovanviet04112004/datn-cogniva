/**
 * AI inline completion cho notes — LLM nhìn context (HTML đã viết trước cursor)
 * và đề xuất 1-2 câu tiếp theo, hoặc 1 dòng bullet/heading hợp lý.
 *
 * Workflow UX:
 *   - User gõ vài câu, dừng ở cuối câu → bấm Tab (hoặc nút "AI gợi ý").
 *   - Endpoint /api/notes/complete nhận `prefix` (text gần cursor, ~500 ký tự
 *     cuối) → LLM stream ra completion.
 *   - UI insert completion tại cursor, user có thể Tab nhận hoặc Esc hủy.
 *
 * Tránh:
 *   - Lặp lại nội dung có sẵn (LLM tự kiềm chế qua prompt).
 *   - Output JSON / markdown rườm rà — chỉ text plain insert.
 */
import { generateText } from 'ai';

import { getChatModel } from '@/lib/ai/models';

const INSTRUCTION = `Bạn là trợ lý viết note. Đoạn dưới là text mà người dùng đã viết. Hãy tiếp tục mạch văn bằng 1-2 câu NGẮN GỌN, đúng phong cách họ đang dùng.

QUY TẮC:
- Tiếp tục TRỰC TIẾP (không có dấu "..." đầu, không lặp câu trước).
- 1-2 câu, ≤ 40 từ.
- Cùng ngôn ngữ với đoạn văn (nếu họ viết tiếng Việt, trả tiếng Việt).
- Không thêm metadata/comment/markdown — chỉ text thuần.

ĐOẠN VĂN ĐÃ VIẾT:
"""
{{PREFIX}}
"""

TIẾP TỤC:`;

/** Sinh completion ngắn cho 1 prefix. Trả '' nếu fail. */
export async function completeNote(prefix: string): Promise<string> {
  const trimmed = prefix.trim();
  if (trimmed.length < 20) return ''; // ít context → bỏ qua

  // Cắt prefix về 500 ký tự cuối để tiết kiệm token + tăng relevance
  const cap = trimmed.length > 500 ? trimmed.slice(-500) : trimmed;

  try {
    const { text } = await generateText({
      model: getChatModel(),
      prompt: INSTRUCTION.replace('{{PREFIX}}', cap),
      temperature: 0.6,
      maxTokens: 120,
    });
    // Loại bỏ leading whitespace/newline + trailing markdown noise
    return text.trim().replace(/^["']|["']$/g, '');
  } catch (err) {
    console.warn('[note-complete] fail:', (err as Error).message);
    return '';
  }
}
