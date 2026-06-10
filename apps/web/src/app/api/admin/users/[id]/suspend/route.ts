/**
 * POST /api/admin/users/[id]/suspend — soft suspend user.
 *
 * Body: { reason: string (10-500) }
 *
 * Effect:
 *   - SET user.suspended_at = NOW(), user.suspend_reason = reason
 *   - DELETE tất cả session của user → force sign-out ngay lập tức
 *   - Log audit { before, after, reason }
 *
 * Quyền: SUPER_ADMIN + ADMIN. Không thể suspend chính mình.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, session as sessionTable, user } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const SCHEMA = z.object({
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
  if (id === admin.userId) {
    return NextResponse.json(
      { error: 'Không thể suspend chính mình' },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'user.suspend',
    { type: 'user', id },
    async () => {
      const [before] = await db
        .select({
          suspendedAt: user.suspendedAt,
          suspendReason: user.suspendReason,
          email: user.email,
        })
        .from(user)
        .where(eq(user.id, id))
        .limit(1);
      if (!before) throw new Error('User not found');
      if (before.suspendedAt) {
        throw new Error('User đã bị suspend từ trước');
      }

      const now = new Date();
      await db
        .update(user)
        .set({
          suspendedAt: now,
          suspendReason: parsed.data.reason,
          updatedAt: now,
        })
        .where(eq(user.id, id));

      // Force sign-out: xoá toàn bộ session → next request sẽ 401
      await db.delete(sessionTable).where(eq(sessionTable.userId, id));

      return {
        before: { suspendedAt: null, suspendReason: null },
        after: { suspendedAt: now.toISOString(), suspendReason: parsed.data.reason },
        reason: parsed.data.reason,
        metadata: { targetEmail: before.email },
        result: { ok: true, suspendedAt: now.toISOString() },
      };
    },
  );

  return NextResponse.json(result);
}
