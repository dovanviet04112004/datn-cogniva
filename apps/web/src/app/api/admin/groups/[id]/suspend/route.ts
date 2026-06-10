/**
 * POST /api/admin/groups/[id]/suspend — suspend study group.
 *
 * Body: { reason: string (10..500) }
 * Set suspended_at = NOW() + suspend_reason. Member không gửi message được
 * khi suspended_at != NULL (chặn ở route handler chat — TODO Phase 2 follow).
 *
 * Auth: SUPER_ADMIN / ADMIN
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
    'group.suspend',
    { type: 'group', id },
    async () => {
      const [before] = await db
        .select({
          id: studyGroup.id,
          name: studyGroup.name,
          suspendedAt: studyGroup.suspendedAt,
        })
        .from(studyGroup)
        .where(eq(studyGroup.id, id))
        .limit(1);
      if (!before) throw new Error('Group not found');
      if (before.suspendedAt) throw new Error('Group đã suspend rồi');

      const now = new Date();
      await db
        .update(studyGroup)
        .set({ suspendedAt: now, suspendReason: reason })
        .where(eq(studyGroup.id, id));

      // Lấy member list để gửi notify ngoài transaction.
      const members = await db
        .select({ userId: studyGroupMember.userId })
        .from(studyGroupMember)
        .where(eq(studyGroupMember.groupId, id));

      return {
        before,
        after: { suspendedAt: now.toISOString(), suspendReason: reason },
        reason,
        metadata: { memberCount: members.length },
        result: {
          ok: true,
          name: before.name,
          memberIds: members.map((m) => m.userId),
        },
      };
    },
  );

  // Fire-and-forget in-app notify
  void notifyGroupSuspend({
    groupId: id,
    groupName: result.name,
    memberIds: result.memberIds,
    reason,
    kind: 'suspend',
  }).catch((err) => console.error('[admin group.suspend notify] fail:', err));

  return NextResponse.json({ ok: true });
}
