/**
 * Regenerate thumbnail TẤT CẢ doc từ trang NỘI DUNG (2026-05-27).
 *
 * Thumbnail cũ = trang bìa (nhiều khoảng trắng, nhìn trống). Script này tải PDF
 * từ R2, lấy trang 2 (nội dung dày chữ) làm thumbnail → trông như tài liệu thật.
 *
 * Usage: pnpm exec tsx --env-file=.env.local scripts/regenerate-thumbnails-all.ts
 */
import { eq, and, like } from 'drizzle-orm';

import { db, libraryDoc } from '@cogniva/db';

import { putR2Object, getPublicUrl } from '../src/lib/r2-client';
import { makeThumbnail } from './lib/pdf-render';

async function main() {
  const docs = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      title: libraryDoc.title,
      fileUrl: libraryDoc.fileUrl,
      fileFormat: libraryDoc.fileFormat,
    })
    .from(libraryDoc)
    .where(and(eq(libraryDoc.status, 'PUBLISHED'), eq(libraryDoc.fileFormat, 'pdf')));

  console.log(`🖼  Regenerate thumbnail (trang nội dung) cho ${docs.length} doc PDF...\n`);
  let ok = 0, skip = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!;
    const tag = `[${i + 1}/${docs.length}] ${doc.title.slice(0, 48)}`;
    // Skip placeholder URLs
    if (doc.fileUrl.startsWith('seed-') || doc.fileUrl.startsWith('remix://')) {
      console.log(`${tag}\n       ⊘ placeholder url — skip`);
      skip++;
      continue;
    }
    try {
      const res = await fetch(doc.fileUrl);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const pdfBuffer = Buffer.from(await res.arrayBuffer());
      const thumb = await makeThumbnail(pdfBuffer);
      if (!thumb) throw new Error('thumbnail null');
      const tkey = `lib/${doc.uploaderId}/${doc.id}-thumb-real.jpg`;
      await putR2Object(tkey, thumb, 'image/jpeg');
      await db
        .update(libraryDoc)
        .set({ previewThumbUrl: getPublicUrl(tkey), updatedAt: new Date() })
        .where(eq(libraryDoc.id, doc.id));
      console.log(`${tag}\n       ✓ thumb ${(thumb.length / 1024).toFixed(0)}KB`);
      ok++;
    } catch (err) {
      console.log(`${tag}\n       ✗ ${(err as Error).message}`);
      skip++;
    }
  }

  console.log(`\n────────────\nOK: ${ok} · Skip: ${skip}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
