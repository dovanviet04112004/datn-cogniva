/**
 * POST /api/flashcards/upload-image — upload ảnh cho IMAGE_OCCLUSION card.
 *
 * multipart/form-data với field "file" (PNG/JPG).
 * Trả { storageKey, url } để client lưu vào card.front.
 *
 * Bảo mật:
 *   - Auth required
 *   - Max 5 MB
 *   - Mime type whitelist (image/png, image/jpeg, image/webp)
 *
 * Storage abstraction reuse từ Phase 1 — local FS hiện tại, R2 sau.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Cần field "file" dạng File' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: `Ảnh quá lớn (>${MAX_SIZE / 1024 / 1024}MB)` }, { status: 413 });
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return NextResponse.json(
      { error: `Mime "${file.type}" không hỗ trợ — chỉ PNG/JPEG/WEBP` },
      { status: 415 },
    );
  }

  // Generate storage key: flashcards/<userId>/<timestamp>-<filename>
  const ts = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  const storageKey = `flashcards/${session.user.id}/${ts}-${safeName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await getStorage().put(storageKey, buffer, file.type);

  return NextResponse.json({
    storageKey,
    // URL public — Phase 1 storage abstraction trả về path local /uploads/...
    // Phase 7 sẽ thay bằng R2 signed URL.
    url: `/api/flashcards/image/${encodeURIComponent(storageKey)}`,
  });
}
