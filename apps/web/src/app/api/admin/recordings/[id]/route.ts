/**
 * DELETE /api/admin/recordings/[id] — force delete 1 voice recording.
 *
 * Body: { reason: string (10..500) }
 * Phase 2 V1 chỉ xoá DB row. File trên R2 cần cleanup job riêng (chạy nightly
 * scan orphan storageKey). Audit log ghi storageKey để forensic recovery.
 *
 * Auth: SUPER_ADMIN / ADMIN
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, recording } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';
import { onRoomRecordingsChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const BODY_SCHEMA = z.object({
  reason: z.string().trim().min(10).max(500),
});

export async function DELETE(request: Request, { params }: Params) {
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
    'recording.delete',
    { type: 'recording', id },
    async () => {
      const [before] = await db
        .select({
          id: recording.id,
          storageKey: recording.storageKey,
          roomId: recording.roomId,
          studyGroupChannelId: recording.studyGroupChannelId,
          duration: recording.duration,
        })
        .from(recording)
        .where(eq(recording.id, id))
        .limit(1);
      if (!before) throw new Error('Recording not found');

      await db.delete(recording).where(eq(recording.id, id));
      // Recording biến khỏi list của room → bust cache (chỉ room recording mới cache).
      if (before.roomId) await onRoomRecordingsChanged(before.roomId);

      return { before, after: null, reason, result: { ok: true } };
    },
  );

  return NextResponse.json(result);
}
