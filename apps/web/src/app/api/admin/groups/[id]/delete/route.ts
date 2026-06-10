/**
 * POST /api/admin/groups/[id]/delete — hard delete group.
 *
 * KHÁC suspend ở chỗ:
 *   - Suspend = reversible (ẩn group, chặn message mới), data giữ nguyên.
 *   - Delete = xoá row group → FK CASCADE xoá channels, messages, members,
 *     invites, recordings, voice states. KHÔNG khôi phục được.
 *
 * Dùng cho case nghiêm trọng: group bị takeover, illegal content, …
 *
 * Body: { reason: string (10..500) }
 * Auth: SUPER_ADMIN only (ADMIN không được hard delete).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroup, studyGroupMember } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';
import { notifyGroupSuspend } from '@/lib/admin/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const BODY_SCHEMA = z.object({
  reason: z.string().trim().min(10).max(500),
});

export async function POST(request: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN']);
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

  // Lấy member list TRƯỚC khi delete để gửi notification (sau delete, FK cascade
  // xoá hết — không query được nữa).
  const memberIds = await db
    .select({ userId: studyGroupMember.userId })
    .from(studyGroupMember)
    .where(eq(studyGroupMember.groupId, id));

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'group.delete',
    { type: 'group', id },
    async () => {
      const [before] = await db
        .select({
          id: studyGroup.id,
          name: studyGroup.name,
          ownerUserId: studyGroup.ownerUserId,
        })
        .from(studyGroup)
        .where(eq(studyGroup.id, id))
        .limit(1);
      if (!before) throw new Error('Group not found');

      // FK CASCADE handle channels/messages/members/invites
      await db.delete(studyGroup).where(eq(studyGroup.id, id));

      return {
        before,
        after: null,
        reason,
        metadata: { memberCount: memberIds.length },
        result: { ok: true, name: before.name },
      };
    },
  );

  // Fire-and-forget notify (group đã bị xoá nên dùng metadata snapshot)
  void notifyGroupSuspend({
    groupId: id,
    groupName: result.name,
    memberIds: memberIds.map((m) => m.userId),
    reason,
    kind: 'delete',
  }).catch((err) => console.error('[admin group.delete notify] fail:', err));

  return NextResponse.json(result);
}
