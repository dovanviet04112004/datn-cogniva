/**
 * PDF parser — wrap unpdf (PDF.js compiled cho Node, không cần native deps).
 *
 * Trả về text từng trang để chunker giữ được metadata page → click citation
 * sau này (Phase 2) có thể nhảy về đúng trang trong PDF viewer.
 *
 * Hạn chế hiện tại:
 *  - Không OCR scan PDF (text-only). PDF chỉ ảnh sẽ trả về chuỗi rỗng.
 *    Phase 1 next iteration: thêm fallback Tesseract/Mistral OCR nếu
 *    số trang text rỗng > N%.
 *  - Không xử lý DOCX / TXT / URL — sẽ thêm dispatcher theo mimeType khi
 *    cần (plan §7.1).
 */
import { extractText } from 'unpdf';

export type ParsedDocument = {
  /** Text từng trang (1-indexed: pages[0] là page 1). */
  pages: string[];
  totalPages: number;
};

/**
 * Trích xuất text từ PDF buffer.
 *
 * @param buffer - Nội dung file PDF
 * @returns Mảng text theo từng trang
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // unpdf cần Uint8Array, không nhận Buffer trực tiếp ở một số phiên bản
  const data = new Uint8Array(buffer);
  const { text, totalPages } = await extractText(data, { mergePages: false });

  // unpdf trả `text` có thể là string (mergePages=true) hoặc string[]
  // (mergePages=false). Force về string[] để xử lý đồng nhất.
  const pages = Array.isArray(text) ? text : [text];

  return { pages, totalPages };
}
