/**
 * Cloze deletion parser — syntax `{{c1::text}}` hoặc `{{c1::text::hint}}`.
 *
 * Anki-compatible format:
 *   "Thủ đô của {{c1::Việt Nam}} là Hà Nội."
 *   → front: "Thủ đô của [...] là Hà Nội." (c1 ẩn)
 *   → back:  "Thủ đô của Việt Nam là Hà Nội." (reveal c1)
 *
 * Multiple cloze cùng index → 1 card che cả 2:
 *   "{{c1::Marie Curie}} đoạt Nobel năm {{c1::1903}}"
 *
 * Different index → KHÔNG support v1 (mỗi cloze 1 card riêng) — giữ đơn
 * giản. Phase 6 có thể split thành nhiều flashcard row khi c2, c3...
 *
 * Hint (optional, sau ::):
 *   "{{c1::Việt Nam::quốc gia}}" → ẩn thành "[quốc gia]"
 */

/** Regex match {{cN::text}} hoặc {{cN::text::hint}}. */
const CLOZE_REGEX = /\{\{c(\d+)::([^}]+?)(?:::([^}]+?))?\}\}/g;

export type ClozeSegment =
  | { type: 'text'; content: string }
  | { type: 'cloze'; index: number; answer: string; hint?: string };

/**
 * Parse cloze text → segments để render. Text thường giữ nguyên,
 * mỗi cloze trở thành object với index + answer.
 */
export function parseCloze(text: string): ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  let lastIndex = 0;
  CLOZE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CLOZE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'cloze',
      index: parseInt(match[1]!, 10),
      answer: match[2]!,
      hint: match[3],
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments;
}

/**
 * Render text dạng "front" — ẩn cloze của 1 index, các index khác show
 * answer thường.
 *
 * @param showIndex - Cloze nào đang được hỏi (1 = c1). Đặt 0 = show tất.
 */
export function renderClozeText(segments: ClozeSegment[], showIndex: number): string {
  return segments
    .map((seg) => {
      if (seg.type === 'text') return seg.content;
      if (seg.index === showIndex) {
        return seg.hint ? `[${seg.hint}]` : '[...]';
      }
      return seg.answer;
    })
    .join('');
}

/** Lấy danh sách unique cloze indices trong text — phục vụ generate nhiều card. */
export function listClozeIndices(text: string): number[] {
  const indices = new Set<number>();
  CLOZE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLOZE_REGEX.exec(text)) !== null) {
    indices.add(parseInt(match[1]!, 10));
  }
  return Array.from(indices).sort((a, b) => a - b);
}
