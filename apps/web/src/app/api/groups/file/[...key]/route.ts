/**
 * GET /api/groups/file/[...key] — serve attachment.
 *
 * Auth required — chỉ user đã login mới đọc được file (V2 sẽ thêm RBAC theo
 * channel.groupId của message gốc, hiện chỉ require auth là đủ vì key
 * unguessable + có userId trong path).
 *
 * Cache: 30 ngày immutable (file ko bao giờ replace cùng key vì có timestamp).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key } = await params;
  const storageKey = key.map((k) => decodeURIComponent(k)).join('/');
  // Chỉ cho phép key thuộc namespace group-attachments
  if (!storageKey.startsWith('group-attachments/')) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }

  try {
    const buf = await getStorage().get(storageKey);
    // Mime detect đơn giản theo extension
    const ext = storageKey.split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    // Blob → BodyInit compatible across Node + browser typings
    return new Response(new Blob([new Uint8Array(buf)], { type: mime }), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=2592000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  zip: 'application/zip',
};
