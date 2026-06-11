import fs from 'node:fs';
import path from 'node:path';

import { eq, like, and } from 'drizzle-orm';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import { db, libraryDoc, libraryDocChunk } from '@cogniva/db';

import { putR2Object, getPublicUrl } from '../src/lib/r2-client';

const REGENERATE = process.argv.includes('--regenerate');

const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');
const REGULAR_TTF = fs.readFileSync(path.join(FONTS_DIR, 'NotoSans-Regular.ttf'));
const BOLD_TTF = fs.readFileSync(path.join(FONTS_DIR, 'NotoSans-Bold.ttf'));

function wrapText(text: string, maxCharsPerLine = 85): string[] {
  const paragraphs = text.split(/\n+/);
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let current = '';
    for (const w of words) {
      if ((current + ' ' + w).length > maxCharsPerLine && current) {
        lines.push(current);
        current = w;
      } else {
        current = current ? `${current} ${w}` : w;
      }
    }
    if (current) lines.push(current);
    lines.push('');
  }
  return lines;
}

async function generatePdf(
  title: string,
  pages: Array<{ pageNum: number; text: string }>,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(REGULAR_TTF);
  const titleFont = await pdfDoc.embedFont(BOLD_TTF);

  const PAGE_WIDTH = 595;
  const PAGE_HEIGHT = 842;
  const MARGIN_LEFT = 60;
  const MARGIN_TOP = 760;
  const MARGIN_BOTTOM = 70;
  const LINE_HEIGHT = 16;
  const FONT_SIZE = 11;

  {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 60,
      width: PAGE_WIDTH,
      height: 60,
      color: rgb(0.55, 0.36, 0.96),
    });
    page.drawText('COGNIVA LIBRARY', {
      x: MARGIN_LEFT,
      y: PAGE_HEIGHT - 38,
      size: 14,
      font: titleFont,
      color: rgb(1, 1, 1),
    });

    const wrappedTitle = wrapText(title, 50);
    let y = PAGE_HEIGHT / 2 + 60;
    for (const line of wrappedTitle.slice(0, 5)) {
      if (line) {
        page.drawText(line, {
          x: MARGIN_LEFT,
          y,
          size: 22,
          font: titleFont,
          color: rgb(0.15, 0.15, 0.15),
        });
      }
      y -= 32;
    }

    page.drawText(`Tạo bởi Cogniva Library — ${new Date().toLocaleDateString('vi-VN')}`, {
      x: MARGIN_LEFT,
      y: 50,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  const sortedPages = [...pages].sort((a, b) => a.pageNum - b.pageNum);
  for (const p of sortedPages) {
    const lines = wrapText(p.text, 85);

    let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = MARGIN_TOP;

    page.drawText(`Trang ${p.pageNum}`, {
      x: MARGIN_LEFT,
      y: PAGE_HEIGHT - 40,
      size: 9,
      font,
      color: rgb(0.55, 0.55, 0.55),
    });
    page.drawLine({
      start: { x: MARGIN_LEFT, y: PAGE_HEIGHT - 48 },
      end: { x: PAGE_WIDTH - MARGIN_LEFT, y: PAGE_HEIGHT - 48 },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85),
    });

    for (const line of lines) {
      if (y < MARGIN_BOTTOM) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = MARGIN_TOP;
        page.drawText(`Trang ${p.pageNum} (tt.)`, {
          x: MARGIN_LEFT,
          y: PAGE_HEIGHT - 40,
          size: 9,
          font,
          color: rgb(0.55, 0.55, 0.55),
        });
      }
      if (line) {
        page.drawText(line, {
          x: MARGIN_LEFT,
          y,
          size: FONT_SIZE,
          font,
          color: rgb(0.15, 0.15, 0.15),
        });
      }
      y -= LINE_HEIGHT;
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function main() {
  const filter = REGENERATE
    ? eq(libraryDoc.status, 'PUBLISHED')
    : and(eq(libraryDoc.status, 'PUBLISHED'), like(libraryDoc.fileUrl, 'seed-%'));

  const docs = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      title: libraryDoc.title,
      fileUrl: libraryDoc.fileUrl,
    })
    .from(libraryDoc)
    .where(filter);

  if (docs.length === 0) {
    console.log('Không có doc cần generate. Dùng --regenerate để override.');
    return;
  }

  console.log(`📄 Generate PDF thật cho ${docs.length} doc...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!;
    const idx = `[${i + 1}/${docs.length}]`;
    console.log(`${idx} ${doc.title.slice(0, 50)}${doc.title.length > 50 ? '…' : ''}`);

    try {
      const chunks = await db
        .select({
          pageNum: libraryDocChunk.pageNum,
          content: libraryDocChunk.content,
        })
        .from(libraryDocChunk)
        .where(eq(libraryDocChunk.docId, doc.id))
        .orderBy(libraryDocChunk.pageNum, libraryDocChunk.chunkIndex);

      if (chunks.length === 0) {
        console.log(`       ⚠ skipped — no chunks`);
        continue;
      }

      const pageMap = new Map<number, string[]>();
      for (const c of chunks) {
        if (!pageMap.has(c.pageNum)) pageMap.set(c.pageNum, []);
        pageMap.get(c.pageNum)!.push(c.content);
      }
      const pages = Array.from(pageMap.entries()).map(([pageNum, contents]) => ({
        pageNum,
        text: contents.join('\n\n'),
      }));

      const pdfBuffer = await generatePdf(doc.title, pages);

      const storageKey = `lib/${doc.uploaderId}/${doc.id}.pdf`;
      await putR2Object(storageKey, pdfBuffer, 'application/pdf');
      const publicUrl = getPublicUrl(storageKey);

      await db
        .update(libraryDoc)
        .set({
          fileUrl: publicUrl,
          fileSizeBytes: pdfBuffer.length,
          pageCount: pages.length + 1,
          updatedAt: new Date(),
        })
        .where(eq(libraryDoc.id, doc.id));

      console.log(`       ✓ ${pages.length + 1} trang, ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
      success++;
    } catch (err) {
      console.log(`       ✗ ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n────────────────────────────────`);
  console.log(`Success: ${success}/${docs.length}`);
  console.log(`Failed: ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
