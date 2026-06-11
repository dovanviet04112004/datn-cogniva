import fs from 'node:fs';
import path from 'node:path';

import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';

import type { Block } from '../fixtures/real-doc-content';

const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');
const REGULAR_TTF = fs.readFileSync(path.join(FONTS_DIR, 'NotoSans-Regular.ttf'));
const BOLD_TTF = fs.readFileSync(path.join(FONTS_DIR, 'NotoSans-Bold.ttf'));

const W = 595,
  H = 842,
  ML = 56,
  MR = 56,
  MTOP = 770,
  MBOT = 64;
const CONTENT_W = W - ML - MR;
const VIOLET = rgb(0.55, 0.36, 0.96);
const INK = rgb(0.13, 0.13, 0.16);
const MUTED = rgb(0.45, 0.45, 0.5);
const CODE_BG = rgb(0.96, 0.96, 0.98);
const FORMULA_BG = rgb(0.95, 0.93, 1);

function wrapByWidth(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let cur = '';
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = trial;
    }
    if (cur) out.push(cur);
  }
  return out;
}

export async function renderDocPdf(
  title: string,
  courseName: string | null,
  blocks: Block[],
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(REGULAR_TTF);
  const bold = await pdf.embedFont(BOLD_TTF);

  let page = pdf.addPage([W, H]);
  let y = MTOP;
  let pageNum = 1;

  const footer = (pg: PDFPage, n: number) => {
    pg.drawText(`${n}`, { x: W / 2 - 4, y: 32, size: 9, font, color: MUTED });
    pg.drawText('Cogniva Library', { x: ML, y: 32, size: 8, font, color: MUTED });
  };

  page.drawRectangle({ x: 0, y: H - 56, width: W, height: 56, color: VIOLET });
  page.drawText('COGNIVA LIBRARY', { x: ML, y: H - 36, size: 13, font: bold, color: rgb(1, 1, 1) });
  if (courseName)
    page.drawText(courseName, { x: ML, y: H - 50, size: 9, font, color: rgb(1, 1, 1) });
  const titleLines = wrapByWidth(title, bold, 23, CONTENT_W);
  let ty = H / 2 + titleLines.length * 16;
  for (const ln of titleLines) {
    page.drawText(ln, { x: ML, y: ty, size: 23, font: bold, color: INK });
    ty -= 31;
  }
  page.drawLine({
    start: { x: ML, y: ty + 4 },
    end: { x: ML + 80, y: ty + 4 },
    thickness: 3,
    color: VIOLET,
  });
  page.drawText(`Biên soạn: Cogniva Library · ${new Date().getFullYear()}`, {
    x: ML,
    y: 90,
    size: 10,
    font,
    color: MUTED,
  });
  footer(page, pageNum);

  const newPage = () => {
    page = pdf.addPage([W, H]);
    pageNum += 1;
    y = MTOP;
    footer(page, pageNum);
  };
  const ensure = (need: number) => {
    if (y - need < MBOT) newPage();
  };
  newPage();

  for (const block of blocks) {
    if (block.type === 'h') {
      ensure(40);
      y -= 10;
      page.drawText(block.text, { x: ML, y, size: 14, font: bold, color: VIOLET });
      y -= 6;
      page.drawLine({
        start: { x: ML, y },
        end: { x: W - MR, y },
        thickness: 0.6,
        color: rgb(0.88, 0.86, 0.94),
      });
      y -= 16;
    } else if (block.type === 'p') {
      for (const ln of wrapByWidth(block.text, font, 11, CONTENT_W)) {
        ensure(16);
        page.drawText(ln, { x: ML, y, size: 11, font, color: INK });
        y -= 16;
      }
      y -= 6;
    } else if (block.type === 'b') {
      const lines = wrapByWidth(block.text, font, 11, CONTENT_W - 16);
      lines.forEach((ln, i) => {
        ensure(15);
        if (i === 0) page.drawText('•', { x: ML, y, size: 11, font: bold, color: VIOLET });
        page.drawText(ln, { x: ML + 16, y, size: 11, font, color: INK });
        y -= 15;
      });
      y -= 4;
    } else if (block.type === 'f') {
      const lines = wrapByWidth(block.text, font, 11, CONTENT_W - 24);
      const boxH = lines.length * 16 + 12;
      ensure(boxH + 6);
      page.drawRectangle({
        x: ML,
        y: y - boxH + 12,
        width: CONTENT_W,
        height: boxH,
        color: FORMULA_BG,
      });
      let fy = y;
      for (const ln of lines) {
        const tw = font.widthOfTextAtSize(ln, 11);
        page.drawText(ln, {
          x: ML + (CONTENT_W - tw) / 2,
          y: fy,
          size: 11,
          font,
          color: rgb(0.32, 0.18, 0.6),
        });
        fy -= 16;
      }
      y -= boxH;
    } else if (block.type === 'code') {
      const wrapped: string[] = [];
      for (const cl of block.text.split('\n'))
        wrapped.push(...(cl.length > 78 ? [cl.slice(0, 78), '  ' + cl.slice(78)] : [cl]));
      const boxH = wrapped.length * 13 + 14;
      ensure(boxH + 6);
      page.drawRectangle({
        x: ML,
        y: y - boxH + 13,
        width: CONTENT_W,
        height: boxH,
        color: CODE_BG,
        borderColor: rgb(0.88, 0.88, 0.92),
        borderWidth: 0.5,
      });
      let cy = y - 2;
      for (const ln of wrapped) {
        page.drawText(ln || ' ', {
          x: ML + 10,
          y: cy,
          size: 9.5,
          font,
          color: rgb(0.2, 0.22, 0.3),
        });
        cy -= 13;
      }
      y -= boxH;
    }
  }

  return Buffer.from(await pdf.save());
}

export function plainText(blocks: Block[]): string {
  return blocks
    .map((bk) => bk.text)
    .join(' ')
    .slice(0, 3000);
}

export async function makeThumbnail(pdfBuffer: Buffer): Promise<Buffer | null> {
  try {
    const { pdf } = await import('pdf-to-img');
    const doc = await pdf(pdfBuffer, {
      scale: 2,
      docInitParams: { verbosity: 0, disableFontFace: true, useSystemFonts: false },
    });
    let idx = 0;
    let firstPage: Buffer | null = null;
    for await (const pageBuf of doc) {
      idx += 1;
      if (idx === 1) {
        firstPage = pageBuf;
        continue;
      }
      return await sharp(pageBuf)
        .resize({ width: 600, height: 800, fit: 'cover', position: 'top' })
        .jpeg({ quality: 85 })
        .toBuffer();
    }
    if (firstPage) {
      return await sharp(firstPage)
        .resize({ width: 600, height: 800, fit: 'cover', position: 'top' })
        .jpeg({ quality: 85 })
        .toBuffer();
    }
  } catch (err) {
    console.log(`       ⚠ thumbnail fail: ${(err as Error).message}`);
  }
  return null;
}
