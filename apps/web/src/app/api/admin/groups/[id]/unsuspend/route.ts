/**
 * POST /api/admin/groups/[id]/unsuspend — restore study group bị suspend.
 *
 * Body: { reason: string (10..500) }
 * Clear suspended_at + suspend_reason.
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
    'group.unsuspend',
    { type: 'group', id },
    async () => {
      const [before] = await db
        .select({
          id: studyGroup.id,
          name: studyGroup.name,
          suspendedAt: studyGroup.suspendedAt,
          suspendReason: studyGroup.suspendReason,
        })
        .from(studyGroup)
        .where(eq(studyGroup.id, id))
        .limit(1);
      if (!before) throw new Error('Group not found');
      if (!before.suspendedAt) throw new Error('Group không bị suspend');

      await db
        .update(studyGroup)
        .set({ suspendedAt: null, suspendReason: null })
        .where(eq(studyGroup.id, id));

      const members = await db
        .select({ userId: studyGroupMember.userId })
        .from(studyGroupMember)
        .where(eq(studyGroupMember.groupId, id));

      return {
        before,
        after: { suspendedAt: null, suspendReason: null },
        reason,
        result: {
          ok: true,
          name: before.name,
          memberIds: members.map((m) => m.userId),
        },
      };
    },
  );

  void notifyGroupSuspend({
    groupId: id,
    groupName: result.name,
    memberIds: result.memberIds,
    reason,
    kind: 'unsuspend',
  }).catch((err) => console.error('[admin group.unsuspend notify] fail:', err));

  return NextResponse.json({ ok: true });
}
