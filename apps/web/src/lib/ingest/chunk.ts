/**
 * Chunker — cắt text dài thành các đoạn nhỏ phù hợp với embedding context.
 *
 * Chiến lược recursive character splitter (đơn giản hoá so với LangChain):
 *  1. Cố cắt theo ranh giới ngữ nghĩa: \n\n (paragraph) → \n (line) →
 *     ". " (sentence) → " " (word) → ký tự đơn.
 *  2. Mỗi chunk target ~512 token (xấp xỉ 2000 ký tự) — vừa với window
 *     1536-dim của text-embedding-3-large mà vẫn giữ ngữ cảnh đủ.
 *  3. Overlap 200 ký tự (~50 token) để câu hỏi nằm giữa biên không bị mất.
 *
 * Lý do KHÔNG dùng LangChain:
 *  - Thêm 50MB deps cho 1 hàm 50 dòng.
 *  - Bản LangChain JS chunker cùng cách hoạt động (recursive separators).
 *
 * Token estimate: ~4 ký tự / token cho tiếng Anh. Tiếng Việt khoảng 2-3 ký
 * tự / token (BPE chia byte). Estimate 4 chars/token là conservative trên
 * và rơi vào vùng an toàn cho cả 2 ngôn ngữ.
 */

export type ChunkInput = {
  /** Nội dung chunk đã cắt. */
  content: string;
  /** Trang gốc (nếu source là PDF). */
  page: number;
  /** Vị trí trong tài liệu (0-based). */
  chunkIndex: number;
  /** Ước lượng số token. */
  tokens: number;
};

const TARGET_CHARS = 2000;
const OVERLAP_CHARS = 200;
const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''] as const;

function estimateTokens(text: string): number {
  // 4 chars/token là rule of thumb của OpenAI cho tiếng Anh
  return Math.ceil(text.length / 4);
}

/**
 * Cắt 1 đoạn text dài thành nhiều chunk theo separator ưu tiên.
 * Dùng đệ quy: nếu vẫn còn quá dài sau khi split theo sep[0], thử sep[1],...
 */
function recursiveSplit(text: string, separators: readonly string[] = SEPARATORS): string[] {
  if (text.length <= TARGET_CHARS) return [text];

  // Tìm separator đầu tiên thực sự xuất hiện trong text
  const sep = separators.find((s) => s === '' || text.includes(s)) ?? '';
  // sep === '' tương đương cắt cứng theo độ dài (fallback cuối cùng)
  const parts = sep === '' ? sliceByLength(text, TARGET_CHARS) : text.split(sep);

  // Gom các part nhỏ thành chunk gần TARGET_CHARS
  const chunks: string[] = [];
  let buffer = '';
  for (const part of parts) {
    const piece = sep === '' ? part : (buffer ? sep : '') + part;
    if (buffer.length + piece.length <= TARGET_CHARS) {
      buffer += piece;
    } else {
      if (buffer) chunks.push(buffer);
      // Nếu 1 part đơn lẻ vẫn quá dài → split tiếp với separators ít cấu trúc hơn
      if (part.length > TARGET_CHARS) {
        chunks.push(...recursiveSplit(part, separators.slice(1)));
        buffer = '';
      } else {
        buffer = part;
      }
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function sliceByLength(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/**
 * Thêm overlap giữa các chunk liên tiếp — phòng câu trả lời nằm giữa biên.
 */
function addOverlap(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const prev = chunks[i - 1] ?? '';
    const tail = prev.slice(-OVERLAP_CHARS);
    return tail + chunk;
  });
}

/**
 * Cắt nguyên tài liệu theo từng trang, gắn metadata page + chunkIndex.
 *
 * @param pages - Mảng text từng trang (từ parsePdf)
 * @returns Danh sách chunk với metadata, sắp xếp theo thứ tự đọc
 */
export function chunkPages(pages: string[]): ChunkInput[] {
  const result: ChunkInput[] = [];
  let globalIndex = 0;

  pages.forEach((pageText, pageIdx) => {
    const cleaned = pageText.trim();
    if (!cleaned) return; // bỏ qua trang trắng

    const split = recursiveSplit(cleaned);
    const withOverlap = addOverlap(split);

    for (const chunk of withOverlap) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      result.push({
        content: trimmed,
        page: pageIdx + 1, // 1-indexed như PDF reader
        chunkIndex: globalIndex++,
        tokens: estimateTokens(trimmed),
      });
    }
  });

  return result;
}
