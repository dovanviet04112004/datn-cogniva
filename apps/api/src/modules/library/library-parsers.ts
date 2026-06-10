/**
 * Format-specific parsers cho Library ingest — port từ
 * apps/web/src/lib/library/parsers.ts (PDF text per page / DOCX mammoth /
 * Image OCR GPT-4o-mini + chunkPageText).
 *
 * KHÁC bản web (apps/api thiếu dep — xem blocker Wave 5):
 *   - PDF text: dùng `unpdf` (pdfjs build cho Node, đã có sẵn) thay vì
 *     pdfjs-dist trực tiếp — cùng engine, giữ strip control chars + caps.
 *   - `sharp` / `pdf-to-img` / `mammoth` chưa cài → load OPTIONAL qua
 *     createRequire: thiếu sharp → thumbnail null (ingest skip upload thumb);
 *     thiếu mammoth → DOCX parse throw (ingest đánh dấu fail như mọi parse error).
 *   - Image OCR: REST fetch OpenAI trực tiếp thay SDK `openai` (request/response
 *     shape giữ nguyên, model gpt-4o-mini).
 */
import { createRequire } from 'node:module';

import { extractText } from 'unpdf';

const optionalRequire = createRequire(__filename);

/** Load dep optional — null nếu chưa cài trong apps/api (xem header). */
function tryRequire<T>(name: string): T | null {
  try {
    return optionalRequire(name) as T;
  } catch {
    return null;
  }
}

/** Output thống nhất sau khi parse file gốc. */
export type ParsedDoc = {
  /** Plain text toàn bộ doc (concat all pages). */
  fullText: string;
  /** Page count (Image = 1, DOCX = approximate từ paragraph count). */
  pageCount: number;
  /** Pages chia nhỏ — page 1, 2, 3 ... */
  pages: Array<{ pageNum: number; text: string }>;
  /** Thumbnail JPEG bytes — null khi sharp chưa cài (bản web luôn có). */
  thumbnailJpeg: Buffer | null;
};

/** Max page extract — tránh OOM với thesis 500+ trang. */
const MAX_PAGES = 200;
/** Max chars per page — slice nếu page quá dài. */
const MAX_PAGE_CHARS = 20_000;

// ─── PDF ─────────────────────────────────────────────────────────────

export async function parsePdf(buffer: Buffer): Promise<ParsedDoc> {
  const data = new Uint8Array(buffer);
  const { text, totalPages } = await extractText(data, { mergePages: false });
  const rawPages = Array.isArray(text) ? text : [text];
  const cappedPages = rawPages.slice(0, MAX_PAGES);

  const pages: ParsedDoc['pages'] = [];
  const textParts: string[] = [];
  for (let p = 0; p < cappedPages.length; p++) {
    const pageText = (cappedPages[p] ?? '')
      // Strip NUL + C0 control chars: pdfjs đôi khi trả 0x00 cho glyph lỗi font,
      // Postgres text column từ chối ("invalid byte sequence 0x00") → ingest fail.
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_PAGE_CHARS);
    if (pageText.length > 0) {
      pages.push({ pageNum: p + 1, text: pageText });
      textParts.push(pageText);
    }
  }

  // Real page-1 thumbnail via pdf-to-img (pdfjs + canvas Node) — optional dep.
  let thumbnail: Buffer | null = null;
  try {
    const pdfToImgMod = tryRequire<{
      pdf: (buf: Buffer, opts: unknown) => Promise<AsyncIterable<Buffer>>;
    }>('pdf-to-img');
    const sharp = loadSharp();
    if (!pdfToImgMod || !sharp) throw new Error('pdf-to-img/sharp chưa cài trong apps/api');
    const doc = await pdfToImgMod.pdf(buffer, {
      scale: 2,
      docInitParams: { verbosity: 0, disableFontFace: true, useSystemFonts: false },
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
    pageCount: totalPages,
    pages,
    thumbnailJpeg: thumbnail,
  };
}

// ─── DOCX ────────────────────────────────────────────────────────────

/**
 * Parse DOCX qua mammoth. DOCX không có "page" concept → simulate page bằng
 * split mỗi ~3000 char (trang A4 ~ 2500-3500 char).
 */
export async function parseDocx(buffer: Buffer): Promise<ParsedDoc> {
  const mammoth = tryRequire<{
    extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
  }>('mammoth');
  if (!mammoth) {
    throw new Error('DOCX parse cần dep "mammoth" — chưa cài trong apps/api (blocker Wave 5)');
  }
  const result = await mammoth.extractRawText({ buffer });
  const fullText = result.value.replace(/\n{3,}/g, '\n\n').trim();

  const APPROX_PAGE_CHARS = 3000;
  const pages: ParsedDoc['pages'] = [];
  let cursor = 0;
  let pageNum = 1;
  while (cursor < fullText.length && pageNum <= MAX_PAGES) {
    // Tìm break point gần page boundary (kết thúc paragraph thay vì giữa câu)
    let end = Math.min(cursor + APPROX_PAGE_CHARS, fullText.length);
    if (end < fullText.length) {
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

  return { fullText, pageCount: pages.length, pages, thumbnailJpeg: thumbnail };
}

// ─── Image (PNG/JPG handwritten notes) ───────────────────────────────

/** Parse image: GPT-4o-mini vision OCR (REST) + sharp resize thumbnail. */
export async function parseImage(buffer: Buffer, mimeType: string): Promise<ParsedDoc> {
  let thumbnailJpeg: Buffer | null = null;
  const sharp = loadSharp();
  if (sharp) {
    thumbnailJpeg = await sharp(buffer)
      .resize({ width: 300, height: 400, fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  // OCR qua GPT-4o-mini vision — REST tương đương openai SDK bản web.
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;
  let ocrText = '';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
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
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    ocrText = json.choices?.[0]?.message?.content?.trim() ?? '';
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

/** Tự động chọn parser theo file_format. */
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

// ─── Placeholder thumb ───────────────────────────────────────────────

/** Placeholder JPEG 300×400 với label + màu format — null nếu thiếu sharp. */
async function generatePlaceholderThumb(label: string, bgColor: string): Promise<Buffer | null> {
  const sharp = loadSharp();
  if (!sharp) return null;
  const svg = `
    <svg width="300" height="400" xmlns="http://www.w3.org/2000/svg">
      <rect width="300" height="400" fill="${bgColor}"/>
      <text x="150" y="180" font-family="sans-serif" font-size="48" fill="white" text-anchor="middle" font-weight="bold">${label}</text>
      <text x="150" y="220" font-family="sans-serif" font-size="14" fill="white" text-anchor="middle" opacity="0.7">Cogniva Library</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

/** Sharp instance kiểu tối thiểu cho các thao tác resize/jpeg dùng ở đây. */
type SharpInstance = {
  resize: (opts: Record<string, unknown>) => SharpInstance;
  jpeg: (opts: { quality: number }) => SharpInstance;
  toBuffer: () => Promise<Buffer>;
};
type SharpLike = (input: Buffer) => SharpInstance;

function loadSharp(): SharpLike | null {
  const mod = tryRequire<{ default?: SharpLike } | SharpLike>('sharp');
  if (!mod) return null;
  return typeof mod === 'function' ? mod : (mod.default ?? null);
}

// ─── Chunking utility ────────────────────────────────────────────────

/**
 * Tách page text thành chunks nhỏ hơn (paragraph-level) để embed: split theo
 * double newline; paragraph > 800 char sub-split theo sentence boundary;
 * min chunk 50 char (skip noise).
 */
export function chunkPageText(pageText: string, maxChunkChars = 800): string[] {
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
