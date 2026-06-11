import { eq, like, and, not } from 'drizzle-orm';
import sharp from 'sharp';
import { pdf } from 'pdf-to-img';

import { db, libraryDoc } from '@cogniva/db';

import { getR2Object, putR2Object, getPublicUrl } from '../src/lib/r2-client';

const REGENERATE = process.argv.includes('--regenerate');

async function renderPdfPage1ToJpeg(pdfBuffer: Buffer): Promise<Buffer> {
  const doc = await pdf(pdfBuffer, {
    scale: 2,
    docInitParams: {
      verbosity: 0,
      disableFontFace: true,
      useSystemFonts: false,
    },
  });
  for await (const pageBuffer of doc) {
    return await sharp(pageBuffer)
      .resize({ width: 600, height: 800, fit: 'cover', position: 'top' })
      .jpeg({ quality: 85 })
      .toBuffer();
  }
  throw new Error('PDF không có page nào');
}

async function main() {
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

  const REAL_SUFFIX = '-thumb-real.jpg';
  const targets = REGENERATE ? docs : docs.filter((d) => !d.previewThumbUrl?.includes(REAL_SUFFIX));

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
      const pdfKeyMatch = doc.fileUrl.match(/\/(lib\/[^/]+\/[^/?]+)/);
      if (!pdfKeyMatch || !pdfKeyMatch[1]) {
        throw new Error('Không extract được R2 key');
      }
      const pdfBuffer = await getR2Object(pdfKeyMatch[1]);

      const jpegBuffer = await renderPdfPage1ToJpeg(pdfBuffer);

      const thumbKey = `lib/${doc.uploaderId}/${doc.id}${REAL_SUFFIX}`;
      await putR2Object(thumbKey, jpegBuffer, 'image/jpeg');
      const publicUrl = getPublicUrl(thumbKey);

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
