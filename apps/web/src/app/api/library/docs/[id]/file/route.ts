/**
 * GET /api/library/docs/[id]/file — Stream PDF (Phase 4, 2026-05-27).
 *
 * Proxy R2 stream qua Next server để tránh CORS issue khi PDF.js fetch
 * presigned URL direct (R2 internal hostname không có CORS cho localhost).
 *
 * PDF.js + react-pdf gọi endpoint này thay vì presigned URL.
 *
 * Note: dùng inline content-disposition cho browser render thay vì download.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db, libraryDoc } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { checkDocAccess } from '@/lib/library/access';
import { getR2Object } from '@/lib/r2-client';

export const runtime = 'nodejs';
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const [doc] = await db
    .select({
      id: libraryDoc.id,
      fileUrl: libraryDoc.fileUrl,
      fileFormat: libraryDoc.fileFormat,
      status: libraryDoc.status,
      uploaderId: libraryDoc.uploaderId,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.status !== 'PUBLISHED' && doc.uploaderId !== session.user.id) {
    return NextResponse.json({ error: 'Not available' }, { status: 403 });
  }

  // Phase 4 Step 5 — gate premium content
  const accessInfo = await checkDocAccess(id, session.user.id);
  if (accessInfo && !accessInfo.access.allowed) {
    return NextResponse.json(
      {
        error: 'Premium doc — cần mua trước khi xem',
        reason: accessInfo.access.reason,
      },
      { status: 402 },
    );
  }

  // Reject demo seed / remix placeholders
  if (doc.fileUrl.startsWith('seed-') || doc.fileUrl.startsWith('remix://')) {
    return NextResponse.json({ error: 'No file content' }, { status: 404 });
  }

  // Extract R2 key
  const match = doc.fileUrl.match(/\/(lib\/[^/]+\/[^/?]+)/);
  if (!match || !match[1]) {
    return NextResponse.json({ error: 'Invalid storage key' }, { status: 500 });
  }
  const storageKey = match[1];

  try {
    const buffer = await getR2Object(storageKey);
    const contentType =
      doc.fileFormat === 'pdf'
        ? 'application/pdf'
        : doc.fileFormat === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'image/png';
    // Wrap Buffer trong Blob để fit BodyInit (Buffer là Node-only type, TS strict)
    const blob = new Blob([new Uint8Array(buffer)], { type: contentType });
    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `inline; filename="${id}.${doc.fileFormat === 'image' ? 'png' : doc.fileFormat}"`,
        // Nội dung bất biến (storageKey theo docId) → cache 24h + immutable, mở lại
        // không tải lại (trước 1h).
        'Cache-Control': 'private, max-age=86400, immutable',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `R2 fetch fail: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
