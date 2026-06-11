import { createRequire } from 'node:module';

import { extractText } from 'unpdf';

const optionalRequire = createRequire(__filename);

function tryRequire<T>(name: string): T | null {
  try {
    return optionalRequire(name) as T;
  } catch {
    return null;
  }
}

export type ParsedDoc = {
  fullText: string;
  pageCount: number;
  pages: Array<{ pageNum: number; text: string }>;
  thumbnailJpeg: Buffer | null;
};

const MAX_PAGES = 200;
const MAX_PAGE_CHARS = 20_000;

export async function parsePdf(buffer: Buffer): Promise<ParsedDoc> {
  const data = new Uint8Array(buffer);
  const { text, totalPages } = await extractText(data, { mergePages: false });
  const rawPages = Array.isArray(text) ? text : [text];
  const cappedPages = rawPages.slice(0, MAX_PAGES);

  const pages: ParsedDoc['pages'] = [];
  const textParts: string[] = [];
  for (let p = 0; p < cappedPages.length; p++) {
    const pageText = (cappedPages[p] ?? '')
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_PAGE_CHARS);
    if (pageText.length > 0) {
      pages.push({ pageNum: p + 1, text: pageText });
      textParts.push(pageText);
    }
  }

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

export async function parseImage(buffer: Buffer, mimeType: string): Promise<ParsedDoc> {
  let thumbnailJpeg: Buffer | null = null;
  const sharp = loadSharp();
  if (sharp) {
    thumbnailJpeg = await sharp(buffer)
      .resize({ width: 300, height: 400, fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();
  }

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
