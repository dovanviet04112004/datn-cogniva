/**
 * Generate REAL page-1 thumbnails từ PDF files (Phase 4 polish, 2026-05-27).
 *
 * Dùng `pdf-to-img` (wrapper pdfjs + canvas Node) render page 1 PDF →
 * PNG → upload R2 → UPDATE library_doc.previewThumbUrl.
 *
 * Giống Studocu/VnDoc/Scribd — preview thumbnail = screenshot trang 1 thực.
 *
 * Yêu cầu: doc đã có real PDF tại R2 (chạy generate-real-pdfs-for-seeds.ts trước).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/generate-real-pdf-thumbnails.ts
 *   pnpm exec tsx --env-file=.env.local scripts/generate-real-pdf-thumbnails.ts --regenerate
 */
import { eq, like, and, not } from 'drizzle-orm';
import sharp from 'sharp';
import { pdf } from 'pdf-to-img';

import { db, libraryDoc } from '@cogniva/db';

import { getR2Object, putR2Object, getPublicUrl } from '../src/lib/r2-client';

const REGENERATE = process.argv.includes('--regenerate');

async function renderPdfPage1ToJpeg(pdfBuffer: Buffer): Promise<Buffer> {
  // pdf-to-img returns AsyncGenerator — chỉ cần page 1
  // Phase 5: tắt LiberationSans fallback warning + ép verbosity=0.
  // PDFs Cogniva tạo đã embed Noto Sans (TTF) qua @pdf-lib/fontkit, nên
  // diacritics render đúng. Warning hiện tại chỉ noise — không phải bug.
  // `disableFontFace: true` + `useSystemFonts: false` để pdfjs Node không cố
  // load font hệ thống (Node không có document.fonts API).
  const doc = await pdf(pdfBuffer, {
    scale: 2,
    docInitParams: {
      verbosity: 0,
      disableFontFace: true,
      useSystemFonts: false,
    },
  });
  for await (const pageBuffer of doc) {
    // pageBuffer là PNG. Convert sang JPEG 85% + resize 600×800 (aspect 3:4)
    return await sharp(pageBuffer)
      .resize({ width: 600, height: 800, fit: 'cover', position: 'top' })
      .jpeg({ quality: 85 })
      .toBuffer();
  }
  throw new Error('PDF không có page nào');
}

async function main() {
  // Filter: docs PUBLISHED có real R2 PDF (không phải seed-/remix://)
  const baseFilter = and(
    eq(libraryDoc.status, 'PUBLISHED'),
    not(like(libraryDoc.fileUrl, 'seed-%')),
    not(like(libraryDoc.fileUrl, 'remix://%')),
    eq(libraryDoc.fileFormat, 'pdf'),
  );

  const docs = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      title: libraryDoc.title,
      fileUrl: libraryDoc.fileUrl,
      previewThumbUrl: libraryDoc.previewThumbUrl,
    })
    .from(libraryDoc)
    .where(baseFilter);

  // Nếu không regenerate, skip docs đã có thumbnail thật (link tới R2 thumb).
  // Tiêu chí: previewThumbUrl chứa '-thumb-real.jpg' (suffix mới).
  const REAL_SUFFIX = '-thumb-real.jpg';
  const targets = REGENERATE
    ? docs
    : docs.filter((d) => !d.previewThumbUrl?.includes(REAL_SUFFIX));

  if (targets.length === 0) {
    console.log('Tất cả PDF docs đã có real thumbnail. Dùng --regenerate để chạy lại.');
    return;
  }

  console.log(`🖼️ Render page-1 PDF thật cho ${targets.length} doc...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const doc = targets[i]!;
    const idx = `[${i + 1}/${targets.length}]`;
    console.log(`${idx} ${doc.title.slice(0, 50)}${doc.title.length > 50 ? '…' : ''}`);

    try {
      // 1. Download PDF từ R2
      const pdfKeyMatch = doc.fileUrl.match(/\/(lib\/[^/]+\/[^/?]+)/);
      if (!pdfKeyMatch || !pdfKeyMatch[1]) {
        throw new Error('Không extract được R2 key');
      }
      const pdfBuffer = await getR2Object(pdfKeyMatch[1]);

      // 2. Render page 1 → JPEG
      const jpegBuffer = await renderPdfPage1ToJpeg(pdfBuffer);

      // 3. Upload R2 thumb với suffix '-thumb-real.jpg' để phân biệt SVG-themed cũ
      const thumbKey = `lib/${doc.uploaderId}/${doc.id}${REAL_SUFFIX}`;
      await putR2Object(thumbKey, jpegBuffer, 'image/jpeg');
      const publicUrl = getPublicUrl(thumbKey);

      // 4. UPDATE doc.preview_thumb_url
      await db
        .update(libraryDoc)
        .set({ previewThumbUrl: publicUrl, updatedAt: new Date() })
        .where(eq(libraryDoc.id, doc.id));

      console.log(`       ✓ ${(jpegBuffer.length / 1024).toFixed(1)} KB`);
      success++;
    } catch (err) {
      console.log(`       ✗ ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n────────────────────────────────`);
  console.log(`Success: ${success}/${targets.length}`);
  console.log(`Failed: ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
