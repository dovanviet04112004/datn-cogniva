/**
 * AI flashcard generator — LLM scan chunks → sinh cặp Q-A cho ôn thi.
 *
 * Hỗ trợ 2 mode:
 *   - BASIC: 1 chunk → 1-3 cặp front/back độc lập
 *   - CLOZE: 1 chunk → câu cloze `{{c1::keyword}}` cho thuật ngữ quan trọng
 *
 * IMAGE_OCCLUSION không có generator AI (cần đầu vào ảnh + user vẽ mask
 * thủ công) — UI riêng.
 *
 * Output JSON schema:
 *   { cards: [{ type: "BASIC"|"CLOZE", front, back, conceptHint? }] }
 *
 * Failure: LLM trả invalid JSON / empty → return [] (skip chunk).
 */
import { generateText } from 'ai';

import { getChatModel } from '@/lib/ai/models';

const BASIC_INSTRUCTION = `Bạn là chuyên gia tạo flashcard ôn thi. Đọc đoạn văn và tạo 1-3 thẻ flashcard ngắn gọn để học sinh ôn lại NỘI DUNG CỐT LÕI.

QUY TẮC:
- Mỗi thẻ có "front" (câu hỏi/khái niệm) và "back" (câu trả lời ngắn 1-2 câu).
- Tập trung vào định nghĩa, fact, công thức, mối quan hệ — không hỏi vu vơ.
- Tránh tạo thẻ trùng ý nhau.
- Trả lời cùng ngôn ngữ với đoạn văn.

ĐỊNH DẠNG OUTPUT — JSON THUẦN, KHÔNG markdown, KHÔNG backtick:
{"cards": [{"front": "...", "back": "..."}]}

ĐOẠN VĂN:
"""
{{CONTENT}}
"""`;

const CLOZE_INSTRUCTION = `Bạn là chuyên gia tạo flashcard cloze. Đọc đoạn văn và sinh 1-3 câu CLOZE để học sinh điền vào chỗ trống.

QUY TẮC:
- Mỗi câu cloze chọn 1 KEYWORD quan trọng (tên, năm, thuật ngữ, công thức) bọc bằng \`{{c1::keyword}}\`.
- Câu phải đủ ngữ cảnh để đoán được từ thiếu (ko quá ngắn).
- Tránh che từ chung chung "is", "the", "of".
- Trả lời cùng ngôn ngữ với đoạn văn.

ĐỊNH DẠNG OUTPUT — JSON THUẦN:
{"cards": [{"text": "Câu có {{c1::keyword}} ở giữa"}]}

ĐOẠN VĂN:
"""
{{CONTENT}}
"""`;

export type GeneratedCard =
  | { type: 'BASIC'; front: string; back: string }
  | { type: 'CLOZE'; text: string };

/** Strip code fence + extract object JSON đầu tiên. */
function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in LLM output');
  return JSON.parse(match[0]);
}

/** Generate cards BASIC từ 1 chunk content. */
export async function generateBasicCards(content: string): Promise<GeneratedCard[]> {
  if (content.length < 50) return [];
  try {
    const { text } = await generateText({
      model: getChatModel(),
      prompt: BASIC_INSTRUCTION.replace('{{CONTENT}}', content),
      temperature: 0.5,
      maxTokens: 600,
    });
    const obj = extractJson(text) as { cards?: unknown };
    if (!Array.isArray(obj.cards)) return [];
    return obj.cards
      .filter(
        (c): c is { front: string; back: string } =>
          typeof (c as { front?: unknown }).front === 'string' &&
          typeof (c as { back?: unknown }).back === 'string',
      )
      .map((c) => ({
        type: 'BASIC' as const,
        front: c.front.trim(),
        back: c.back.trim(),
      }));
  } catch (err) {
    console.warn('[generate-basic] skip:', (err as Error).message);
    return [];
  }
}

/** Generate cards CLOZE từ 1 chunk content. */
export async function generateClozeCards(content: string): Promise<GeneratedCard[]> {
  if (content.length < 50) return [];
  try {
    const { text } = await generateText({
      model: getChatModel(),
      prompt: CLOZE_INSTRUCTION.replace('{{CONTENT}}', content),
      temperature: 0.5,
      maxTokens: 600,
    });
    const obj = extractJson(text) as { cards?: unknown };
    if (!Array.isArray(obj.cards)) return [];
    return obj.cards
      .filter((c): c is { text: string } => typeof (c as { text?: unknown }).text === 'string')
      .map((c) => ({ type: 'CLOZE' as const, text: c.text.trim() }))
      .filter((c) => /\{\{c\d+::/.test(c.text)); // chỉ giữ nếu có cloze marker
  } catch (err) {
    console.warn('[generate-cloze] skip:', (err as Error).message);
    return [];
  }
}
