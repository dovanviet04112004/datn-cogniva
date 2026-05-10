/**
 * GET /api/flashcards/image/[...key] — stream ảnh card từ storage.
 *
 * Bảo mật: chỉ check session, KHÔNG verify ownership (ảnh public-ish trong
 * scope user đã login). Khi feature share card với người khác, sẽ thêm
 * access control list.
 *
 * key dùng catch-all route để giữ "/" trong storage key (flashcards/<uid>/...).
 */
import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { key } = await params;
  const storageKey = decodeURIComponent(key.join('/'));

  try {
    const buffer = await getStorage().get(storageKey);
    // Inferred MIME từ extension — đơn giản, đủ cho 3 type cho phép upload
    const ext = storageKey.split('.').pop()?.toLowerCase();
    const mime =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return new Response(new Blob([new Uint8Array(buffer)], { type: mime }), {
      headers: {
        'Content-Type': mime,
        'Content-Length': buffer.byteLength.toString(),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[image] storage read failed:', err);
    return new Response('Not found', { status: 404 });
  }
}
