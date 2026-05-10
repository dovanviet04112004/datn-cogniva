/**
 * POST /api/documents/upload — nhận file PDF từ form multipart, lưu vào
 * storage, tạo document row, chạy ingest pipeline ĐỒNG BỘ rồi trả response.
 *
 * Đáp ứng:
 *   200 { id, filename, status }   — ingest thành công, status=READY
 *   207 { id, filename, status, error }  — file đã lưu nhưng ingest fail
 *   400 { error }                  — input không hợp lệ
 *   401 { error }                  — chưa đăng nhập
 *
 * Phase 1 chấp nhận block client tới khi ingest xong (đơn PDF mất 5-30s).
 * Khi swap Inngest, route sẽ trả 200 ngay khi save file + enqueue job; UI
 * polling status của document.
 *
 * Lưu ý:
 *  - export `runtime = 'nodejs'` BẮT BUỘC vì unpdf + openai SDK dùng API
 *    Node-only (Buffer, stream). Edge runtime sẽ crash.
 *  - export `maxDuration` để Vercel cho phép request dài (tối đa 300s ở
 *    Pro plan; Phase 1 dev không bị giới hạn).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { db, document } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { ingestDocument } from '@/lib/ingest/pipeline';
import { getStorage } from '@/lib/storage';
import { getOrCreateDefaultWorkspace } from '@/lib/workspace';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — chặn upload PDF khổng lồ
const ALLOWED_MIME = ['application/pdf'] as const;

export async function POST(request: Request) {
  // ── 1. Auth check ─────────────────────────────────────
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  // ── 2. Parse multipart ───────────────────────────────
  let file: File;
  try {
    const form = await request.formData();
    const value = form.get('file');
    if (!(value instanceof File)) {
      return NextResponse.json(
        { error: 'Field "file" thiếu hoặc không phải file' },
        { status: 400 },
      );
    }
    file = value;
  } catch {
    return NextResponse.json({ error: 'Body không phải multipart/form-data' }, { status: 400 });
  }

  // ── 3. Validate file ─────────────────────────────────
  if (file.size === 0) {
    return NextResponse.json({ error: 'File rỗng' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File vượt giới hạn ${MAX_FILE_BYTES / (1024 * 1024)} MB` },
      { status: 400 },
    );
  }
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return NextResponse.json(
      { error: `MIME type không hỗ trợ: ${file.type || 'unknown'}. Phase 1 chỉ nhận PDF.` },
      { status: 400 },
    );
  }

  // ── 4. Lưu file vào storage ──────────────────────────
  const ws = await getOrCreateDefaultWorkspace(userId);
  const buffer = Buffer.from(await file.arrayBuffer());

  // Tạo document trước để có ID làm storage key
  const [created] = await db
    .insert(document)
    .values({
      userId,
      workspaceId: ws.id,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      // Tạm storageKey rỗng, update ngay sau khi có ID
      storageKey: '',
      status: 'PROCESSING',
      metadata: {},
    })
    .returning();
  if (!created) {
    return NextResponse.json({ error: 'Không tạo được document record' }, { status: 500 });
  }

  const storageKey = `${userId}/${created.id}.pdf`;
  const storage = getStorage();
  await storage.put(storageKey, buffer, file.type);

  // Update storageKey
  const { eq } = await import('drizzle-orm');
  await db.update(document).set({ storageKey }).where(eq(document.id, created.id));

  // ── 5. Run ingest pipeline (synchronous) ─────────────
  try {
    await ingestDocument(created.id);
    return NextResponse.json({ id: created.id, filename: file.name, status: 'READY' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[upload] ingest failed:', error);
    // Multi-status: file đã lưu nhưng pipeline fail — UI sẽ hiển thị FAILED badge
    return NextResponse.json(
      { id: created.id, filename: file.name, status: 'FAILED', error: message },
      { status: 207 },
    );
  }
}
