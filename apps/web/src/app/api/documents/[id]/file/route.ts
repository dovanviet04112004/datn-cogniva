/**
 * GET /api/documents/[id]/file — stream nội dung PDF gốc xuống client.
 *
 * Bảo mật: verify document.userId === session.user.id (chống IDOR).
 * Storage abstraction (local FS hiện tại / R2 sau) đọc Buffer rồi Response
 * stream về browser với content-type đúng.
 */
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';

import { db, document } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { id } = await params;

  const [doc] = await db
    .select()
    .from(document)
    .where(and(eq(document.id, id), eq(document.userId, session.user.id)))
    .limit(1);
  if (!doc) return new Response('Not found', { status: 404 });

  try {
    const buffer = await getStorage().get(doc.storageKey);
    // Wrap Buffer trong Blob — Blob được Web BodyInit accept và xử lý được
    // Node Buffer | Uint8Array tương tự nhau. Browser nhận về dạng binary
    // bình thường, không cần convert thủ công.
    const blob = new Blob([new Uint8Array(buffer)], { type: doc.mimeType });
    return new Response(blob, {
      headers: {
        'Content-Type': doc.mimeType,
        'Content-Length': buffer.byteLength.toString(),
        // Cho phép cache phía browser nhưng yêu cầu re-validate (file có thể bị xoá)
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'Content-Disposition': `inline; filename="${encodeURIComponent(doc.filename)}"`,
      },
    });
  } catch (err) {
    console.error('[api/documents/[id]/file] storage read failed:', err);
    return new Response('File not found in storage', { status: 404 });
  }
}
