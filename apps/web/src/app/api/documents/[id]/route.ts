/**
 * DELETE /api/documents/[id] — xoá document + cascade chunks + storage file.
 *
 * V8.13 (2026-05-20): trước đây documents chỉ xoá qua admin / manual SQL.
 * Giờ user xoá trực tiếp từ Sources panel workspace.
 *
 * Cascade:
 *   - `chunk` table có FK `document_id ON DELETE CASCADE` → chunks tự xoá
 *   - `note.document_id` ON DELETE SET NULL → notes vẫn tồn tại, link mất
 *   - Flashcards / quiz / exam: gắn vào `concept` (atom), KHÔNG trực tiếp
 *     vào document → giữ nguyên
 *   - Storage file: xoá bằng `getStorage().delete(storageKey)` (no-op nếu
 *     không tồn tại)
 *
 * Bảo mật: verify `document.userId === session.user.id` (chống IDOR).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db, document } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onDocumentChanged } from '@/lib/cache/invalidate';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership trước khi xoá. Lấy thêm workspaceId để invalidate đúng
  // workspaceStats/atoms của workspace chứa doc (xem onDocumentChanged bên dưới).
  const [doc] = await db
    .select({
      id: document.id,
      userId: document.userId,
      storageKey: document.storageKey,
      workspaceId: document.workspaceId,
    })
    .from(document)
    .where(eq(document.id, id))
    .limit(1);
  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (doc.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Best-effort xoá storage file — không fail nếu file biến mất
  try {
    await getStorage().delete(doc.storageKey);
  } catch (err) {
    console.warn('[api/documents/[id] DELETE] storage delete failed:', err);
  }

  // Xoá doc row — chunks tự cascade do FK
  await db.delete(document).where(eq(document.id, id));

  // Bust cache SAU khi xoá thành công, TRƯỚC khi trả response. Fan-out:
  // list documents + docCount sidebar + graph + dashboard + stats/atoms workspace.
  await onDocumentChanged(doc.userId, doc.workspaceId);

  return NextResponse.json({ deleted: true });
}
