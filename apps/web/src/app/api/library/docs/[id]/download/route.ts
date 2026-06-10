/**
 * GET /api/library/docs/[id]/download — generate signed URL + increment counter.
 *
 * Trả về 302 redirect tới R2 signed URL (expire 1h). Đếm download_count.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';

import { db, libraryDoc } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { checkDocAccess } from '@/lib/library/access';
import { getPresignedDownloadUrl } from '@/lib/r2-client';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const [doc] = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      fileUrl: libraryDoc.fileUrl,
      status: libraryDoc.status,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, id))
    .limit(1);

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.status !== 'PUBLISHED' && doc.uploaderId !== session.user.id) {
    return NextResponse.json({ error: 'Not available' }, { status: 403 });
  }

  // Phase 4 Step 5 — gate premium content (cùng rule với /file + /import)
  const accessInfo = await checkDocAccess(id, session.user.id);
  if (accessInfo && !accessInfo.access.allowed) {
    return NextResponse.json(
      {
        error: 'Premium doc — cần mua trước khi tải về',
        reason: accessInfo.access.reason,
      },
      { status: 402 },
    );
  }

  // Seed doc detection — chỉ trả demo cho remix:// hoặc seed-v* placeholder.
  // (Sau khi chạy generate-real-pdfs-for-seeds.ts, fileUrl chuyển sang R2 thật.)
  if (doc.fileUrl.startsWith('seed-') || doc.fileUrl.startsWith('remix://')) {
    return NextResponse.json(
      {
        demo: true,
        message: 'Doc tổng hợp — content kế thừa từ source docs, xem preview các nguồn gốc bên dưới.',
      },
      { status: 200 },
    );
  }

  // Extract R2 key
  const match = doc.fileUrl.match(/\/(lib\/[^/]+\/[^/?]+)/);
  if (!match || !match[1]) {
    return NextResponse.json({ error: 'Invalid file URL' }, { status: 500 });
  }
  const storageKey = match[1];
  const signedUrl = await getPresignedDownloadUrl(storageKey, 3600);

  // Increment counter fire-and-forget
  void db
    .update(libraryDoc)
    .set({ downloadCount: sql`${libraryDoc.downloadCount} + 1` })
    .where(eq(libraryDoc.id, id))
    .catch(() => {});

  return NextResponse.json({ url: signedUrl });
}
