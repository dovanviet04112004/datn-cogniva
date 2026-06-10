/**
 * DELETE /api/channels/[id]/record/[recordingId] — xoá recording.
 *
 * Flow:
 *   1. Verify mod permission (voice.record).
 *   2. Nếu status = RECORDING → bắt stop trước (gọi /stop endpoint, không
 *      cho xoá file đang ghi vì egress LiveKit sẽ tiếp tục upload).
 *   3. Xoá object R2 (best-effort — skip nếu fail vì file có thể đã xoá tay).
 *   4. Xoá row DB (cascade message system nếu cần).
 *
 * Auth: chỉ MODERATOR+ (perm `voice.record`).
 *
 * Idempotent: gọi 2 lần → lần 2 trả 404 vì row đã xoá.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import {
  db,
  recording,
  studyGroupChannel,
  studyGroupMember,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, type GroupRole } from '@/lib/group/permissions';
import { deleteR2Object } from '@/lib/r2-client';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; recordingId: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: channelId, recordingId } = await params;

  // Verify mod
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  const [member] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member || !can(member.role as GroupRole, 'voice.record')) {
    return NextResponse.json(
      { error: 'Chỉ mod/admin/owner mới được xoá recording' },
      { status: 403 },
    );
  }

  const [rec] = await db
    .select({
      id: recording.id,
      status: recording.status,
      storageKey: recording.storageKey,
    })
    .from(recording)
    .where(
      and(
        eq(recording.id, recordingId),
        eq(recording.studyGroupChannelId, channelId),
      ),
    )
    .limit(1);
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });

  if (rec.status === 'RECORDING') {
    return NextResponse.json(
      { error: 'Đang ghi — bấm dừng trước khi xoá' },
      { status: 409 },
    );
  }

  // Xoá object R2 — best-effort, không throw nếu fail (file có thể đã được
  // xoá thủ công, hoặc R2 outage tạm thời).
  if (rec.storageKey) {
    try {
      await deleteR2Object(rec.storageKey);
    } catch (err) {
      console.error('[record/delete] R2 delete fail:', err);
      // tiếp tục xoá DB row — R2 file mồ côi sẽ được cron sweep V2
    }
  }

  // Xoá DB row
  await db.delete(recording).where(eq(recording.id, recordingId));

  // Broadcast để UI list/replay realtime remove item
  await triggerEvent(`presence-voice-${channelId}`, 'recording:deleted', {
    recordingId,
  });

  return NextResponse.json({ ok: true });
}
