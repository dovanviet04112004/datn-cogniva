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
 * Khi chuyển sang BullMQ, route sẽ trả 200 ngay khi save file + enqueue job; UI
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

import { and, eq } from 'drizzle-orm';

import { db, document, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onDocumentChanged } from '@/lib/cache/invalidate';
import { awardXp, XP_AMOUNTS } from '@/lib/gamification/xp';
import { checkLimit } from '@/lib/rate-limit';
import { ingestDocument } from '@/lib/ingest/pipeline';
import { getStorage } from '@/lib/storage';

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

  const rl = await checkLimit(`upload:${userId}`, 'upload');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many uploads' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  // ── 2. Parse multipart ───────────────────────────────
  let file: File;
  // workspaceId BẮT BUỘC — user chọn workspace để upload doc vào ĐÚNG chỗ.
  // KHÔNG còn fallback "Default" hay auto-route theo nội dung nữa.
  let requestedWorkspaceId: string | null = null;
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
    const wsField = form.get('workspaceId');
    if (typeof wsField === 'string' && wsField.trim().length > 0) {
      requestedWorkspaceId = wsField.trim();
    }
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
  // Workspace đích BẮT BUỘC do user chọn — verify ownership rồi dùng đúng cái đó.
  if (!requestedWorkspaceId) {
    return NextResponse.json(
      { error: 'Hãy chọn workspace để upload tài liệu vào' },
      { status: 400 },
    );
  }
  const owned = await db
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(and(eq(workspace.id, requestedWorkspaceId), eq(workspace.userId, userId)))
    .limit(1);
  if (owned.length === 0) {
    return NextResponse.json(
      { error: 'Workspace không tồn tại hoặc không thuộc về bạn' },
      { status: 400 },
    );
  }
  const ws = owned[0]!;
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
  await db.update(document).set({ storageKey }).where(eq(document.id, created.id));

  // ── 5. Run ingest pipeline (synchronous) ─────────────
  try {
    await ingestDocument(created.id);
    // Gamification: +20 XP cho mỗi upload thành công
    await awardXp(userId, XP_AMOUNTS.DOCUMENT_UPLOAD, {
      source: 'document',
      totalCount: 1,
    });

    // Bust cache SAU khi doc đã READY, TRƯỚC khi trả response. Fan-out: list
    // documents + docCount sidebar + graph + dashboard + stats/atoms của ĐÚNG
    // workspace user đã chọn. (awardXp ở trên chỉ xoá dashboard/profile — KHÔNG
    // phủ list/sidebar, nên call này bắt buộc.)
    await onDocumentChanged(userId, ws.id);

    return NextResponse.json({
      id: created.id,
      filename: file.name,
      status: 'READY',
      workspaceId: ws.id,
      workspaceName: ws.name,
    });
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
