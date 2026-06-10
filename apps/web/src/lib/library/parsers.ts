/**
 * Format-specific parsers — V1 Library (2026-05-22).
 *
 * Phase 1 hỗ trợ 3 format:
 *   - PDF: dùng pdfjs-dist extract text per page + sharp thumbnail
 *   - DOCX: mammoth convert → text + tách paragraph
 *   - Image: GPT-4o vision OCR + sharp resize thumbnail
 *
 * Mỗi parser trả về ParsedDoc shape thống nhất → ingest pipeline xử lý chung.
 *
 * Spec: docs/plans/library-share.md §Tech / Indexing Pipeline.
 */
import OpenAI from 'openai';
import sharp from 'sharp';

let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _openai;
}

/** Output thống nhất sau khi parse file gốc. */
export type ParsedDoc = {
  /** Plain text toàn bộ doc (concat all pages). */
  fullText: string;
  /** Page count (Image = 1, DOCX = approximate từ paragraph count). */
  pageCount: number;
  /** Pages chia nhỏ — page 1, 2, 3 ... */
  pages: Array<{ pageNum: number; text: string }>;
  /** Thumbnail JPEG bytes (300×400 max). */
  thumbnailJpeg: Buffer;
};

/** Max page extract — tránh OOM với thesis 500+ trang. */
const MAX_PAGES = 200;
/** Max chars per page — slice nếu page quá dài. */
const MAX_PAGE_CHARS = 20_000;

// ─── PDF ─────────────────────────────────────────────────────────────

/**
 * Parse PDF từ buffer. Dùng pdfjs-dist (Node-compatible build).
 *
 * Lưu ý: Thumbnail Phase 1 dùng placeholder (icon). Phase 2 sẽ render trang 1
 * thực qua canvas. Tạm thời sharp generate solid color thumb với metadata.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDoc> {
  // Lazy import pdfjs-dist (large, chỉ load khi cần)
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;
  const totalPages = Math.min(pdf.numPages, MAX_PAGES);

  const pages: ParsedDoc['pages'] = [];
  const textParts: string[] = [];
  for (let p = 1; p <= totalPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      // Strip NUL + C0 control chars: pdfjs đôi khi trả 0x00 cho glyph lỗi font,
      // Postgres text column từ chối ("invalid byte sequence 0x00") → ingest fail.
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_PAGE_CHARS);
    if (pageText.length > 0) {
      pages.push({ pageNum: p, text: pageText });
      textParts.push(pageText);
    }
  }

  // Real page-1 thumbnail via pdf-to-img (pdfjs + canvas Node)
  let thumbnail: Buffer;
  try {
    const { pdf: pdfToImg } = await import('pdf-to-img');
    // Phase 5: tắt LiberationSans fallback warning + system font load (Node
    // không có document.fonts). Cogniva PDF đã embed Noto Sans qua pdf-lib.
    const doc = await pdfToImg(buffer, {
      scale: 2,
      docInitParams: {
        verbosity: 0,
        disableFontFace: true,
        useSystemFonts: false,
      },
    });
    let pngBuffer: Buffer | null = null;
    for await (const pageBuf of doc) {
      pngBuffer = pageBuf;
      break;
    }
    if (pngBuffer) {
      thumbnail = await sharp(pngBuffer)
        .resize({ width: 600, height: 800, fit: 'cover', position: 'top' })
        .jpeg({ quality: 85 })
        .toBuffer();
    } else {
      throw new Error('pdf-to-img returned empty');
    }
  } catch (err) {
    console.error('[parsers.pdf-thumb fallback]', err);
    thumbnail = await generatePlaceholderThumb('PDF', '#dc2626');
  }

  return {
    fullText: textParts.join('\n\n'),
    pageCount: pdf.numPages,
    pages,
    thumbnailJpeg: thumbnail,
  };
}

// ─── DOCX ────────────────────────────────────────────────────────────

/**
 * Parse DOCX từ buffer. Dùng mammoth extract raw text.
 *
 * DOCX không có "page" concept (phân trang là rendering-time) → simulate
 * page bằng split mỗi ~3000 char.
 */
export async function parseDocx(buffer: Buffer): Promise<ParsedDoc> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  const fullText = result.value.replace(/\n{3,}/g, '\n\n').trim();

  // Simulate page break — split per ~3000 chars (trang A4 ~ 2500-3500 char)
  const APPROX_PAGE_CHARS = 3000;
  const pages: ParsedDoc['pages'] = [];
  let cursor = 0;
  let pageNum = 1;
  while (cursor < fullText.length && pageNum <= MAX_PAGES) {
    // Tìm break point gần page boundary (kết thúc paragraph thay vì giữa câu)
    let end = Math.min(cursor + APPROX_PAGE_CHARS, fullText.length);
    if (end < fullText.length) {
      // Đẩy end về trước nếu trong giữa câu
      const nextNewline = fullText.indexOf('\n', end);
      if (nextNewline > 0 && nextNewline - end < 500) end = nextNewline;
    }
    const text = fullText.slice(cursor, end).trim();
    if (text.length > 0) {
      pages.push({ pageNum, text: text.slice(0, MAX_PAGE_CHARS) });
    }
    cursor = end;
    pageNum++;
  }

  const thumbnail = await generatePlaceholderThumb('DOCX', '#2563eb');

  return {
    fullText,
    pageCount: pages.length,
    pages,
    thumbnailJpeg: thumbnail,
  };
}

// ─── Image (PNG/JPG handwritten notes) ───────────────────────────────

/**
 * Parse image qua GPT-4o vision OCR + sharp resize thumbnail.
 *
 * Output: 1-page doc với text = OCR extracted, thumbnail = ảnh gốc resize.
 *
 * Cost note: GPT-4o vision ~$0.003/image. Cogniva absorb cost Phase 1
 * (limit 50 doc/user free anti-abuse).
 */
export async function parseImage(
  buffer: Buffer,
  mimeType: string,
): Promise<ParsedDoc> {
  // Generate thumbnail từ image gốc — sharp resize 300×400 max
  const thumbnailJpeg = await sharp(buffer)
    .resize({ width: 300, height: 400, fit: 'inside' })
    .jpeg({ quality: 80 })
    .toBuffer();

  // OCR text qua GPT-4o vision
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;
  let ocrText = '';
  try {
    const response = await openaiClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Trích xuất TẤT CẢ văn bản tiếng Việt / tiếng Anh trong ảnh này. Chỉ trả về văn bản, không thêm chú thích.',
            },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
      max_tokens: 2000,
    });
    ocrText = response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    console.error('[parseImage OCR fail]', (err as Error).message);
    ocrText = '[Không OCR được — vui lòng nhập mô tả thủ công]';
  }

  return {
    fullText: ocrText,
    pageCount: 1,
    pages: [{ pageNum: 1, text: ocrText }],
    thumbnailJpeg,
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────

/**
 * Tự động chọn parser theo file_format.
 *
 * @param buffer file bytes
 * @param format 'pdf'|'docx'|'image'
 * @param mimeType cho image (vd 'image/png'); ignored cho pdf/docx
 */
export async function parseFile(
  buffer: Buffer,
  format: 'pdf' | 'docx' | 'image',
  mimeType?: string,
): Promise<ParsedDoc> {
  switch (format) {
    case 'pdf':
      return parsePdf(buffer);
    case 'docx':
      return parseDocx(buffer);
    case 'image':
      return parseImage(buffer, mimeType ?? 'image/png');
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

// ─── Placeholder thumb (Phase 1 fallback) ───────────────────────────

/**
 * Generate placeholder thumbnail JPEG 300×400 với label + màu format.
 * Phase 2 sẽ render trang 1 PDF thật qua canvas.
 */
async function generatePlaceholderThumb(
  label: string,
  bgColor: string,
): Promise<Buffer> {
  const svg = `
    <svg width="300" height="400" xmlns="http://www.w3.org/2000/svg">
      <rect width="300" height="400" fill="${bgColor}"/>
      <text x="150" y="180" font-family="sans-serif" font-size="48" fill="white" text-anchor="middle" font-weight="bold">${label}</text>
      <text x="150" y="220" font-family="sans-serif" font-size="14" fill="white" text-anchor="middle" opacity="0.7">Cogniva Library</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

// ─── Chunking utility ────────────────────────────────────────────────

/**
 * Tách page text thành chunks nhỏ hơn (paragraph-level) để embed.
 *
 * Strategy: split theo double newline (paragraph). Nếu paragraph > 800 char
 * thì sub-split theo sentence boundary. Min chunk 50 char (skip noise).
 */
export function chunkPageText(
  pageText: string,
  maxChunkChars = 800,
): string[] {
  const paragraphs = pageText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 50);

  const chunks: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChunkChars) {
      chunks.push(para);
      continue;
    }
    // Split tiếp theo câu nếu paragraph quá dài
    const sentences = para.split(/(?<=[.!?])\s+/);
    let current = '';
    for (const s of sentences) {
      if ((current + ' ' + s).length > maxChunkChars && current) {
        chunks.push(current.trim());
        current = s;
      } else {
        current = current ? `${current} ${s}` : s;
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }
  return chunks;
}
