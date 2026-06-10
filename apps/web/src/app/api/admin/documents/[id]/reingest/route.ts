/**
 * POST /api/admin/documents/[id]/reingest — re-run ingestion pipeline.
 *
 * Dùng khi document ở trạng thái FAILED hoặc chunks bị corrupt. Flow:
 *   1. Xoá toàn bộ chunks hiện tại (FK CASCADE).
 *   2. Reset status → PROCESSING.
 *   3. Fire-and-forget gọi ingestDocument(id) — không await, response trả
 *      ngay. Status sẽ flip sang READY/FAILED khi pipeline xong, UI poll
 *      list để cập nhật.
 *
 * Body: { reason: string (10..500) }
 * Auth: SUPER_ADMIN / ADMIN
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { chunk, db, document } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';
import { ingestDocument } from '@/lib/ingest/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const BODY_SCHEMA = z.object({
  reason: z.string().trim().min(10).max(500),
});

export async function POST(request: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN', 'ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { reason } = parsed.data;

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'document.reingest',
    { type: 'document', id },
    async () => {
      const [before] = await db
        .select({ id: document.id, status: document.status, filename: document.filename })
        .from(document)
        .where(eq(document.id, id))
        .limit(1);
      if (!before) throw new Error('Document not found');

      // 1. Xoá chunks cũ — pipeline sẽ tạo lại
      await db.delete(chunk).where(eq(chunk.documentId, id));
      // 2. Reset status
      await db
        .update(document)
        .set({ status: 'PROCESSING' })
        .where(eq(document.id, id));

      return {
        before,
        after: { status: 'PROCESSING' },
        reason,
        result: { ok: true, started: true },
      };
    },
  );

  // 3. Fire-and-forget pipeline — KHÔNG await. Pipeline tự catch lỗi và đặt
  //    status = FAILED. Response trả ngay nên admin không bị block 5-30s.
  void ingestDocument(id).catch((err) => {
    console.error('[admin reingest] pipeline failed:', err);
  });

  return NextResponse.json(result);
}
