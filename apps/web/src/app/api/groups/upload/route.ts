/**
 * POST /api/groups/upload — upload file đính kèm cho message.
 *
 * multipart/form-data: field "file" + optional "channelId" (audit + scope).
 * Trả { storageKey, url, type, size, mime, name } để client gắn vào
 * mảng `attachments` khi POST /messages.
 *
 * Bảo mật:
 *   - Auth required
 *   - Max 25 MB (Discord free tier reference)
 *   - Mime whitelist image/video/audio/pdf/text/zip
 *   - File name sanitize
 *
 * Storage: reuse abstraction `getStorage()` — local FS dev, R2 prod (xem
 * lib/storage/index.ts).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME = new Set([
  // image
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // audio
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  // video
  'video/mp4',
  'video/webm',
  // doc
  'application/pdf',
  'text/plain',
  'text/markdown',
  // archive
  'application/zip',
]);

function inferType(mime: string): 'image' | 'audio' | 'video' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Cần field "file"' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `File quá lớn (>${MAX_SIZE / 1024 / 1024}MB)` },
      { status: 413 },
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Mime "${file.type}" không hỗ trợ` },
      { status: 415 },
    );
  }

  // Storage key: group-attachments/<userId>/<timestamp>-<safeName>
  const ts = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  const storageKey = `group-attachments/${session.user.id}/${ts}-${safeName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await getStorage().put(storageKey, buffer, file.type);

  return NextResponse.json({
    storageKey,
    url: `/api/groups/file/${encodeURIComponent(storageKey)}`,
    type: inferType(file.type),
    size: file.size,
    mime: file.type,
    name: file.name,
  });
}
