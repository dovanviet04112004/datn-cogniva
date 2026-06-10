/**
 * POST /api/admin/users/[id]/force-signout — invalidate toàn bộ session.
 *
 * Body: { reason: string (10-500) }
 *
 * Khác suspend: chỉ xoá session, user vẫn login lại được. Dùng khi:
 *   - Sec incident: nghi credential leak → force re-auth
 *   - User báo "ai đó đang dùng tài khoản tôi"
 *
 * Mọi role admin được dùng (kể cả SUPPORT — không destructive lâu dài).
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
    admin = await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'user.force_signout',
    { type: 'user', id },
    async () => {
      const [target] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, id))
        .limit(1);
      if (!target) throw new Error('User not found');

      const deleted = await db
        .delete(sessionTable)
        .where(eq(sessionTable.userId, id))
        .returning({ id: sessionTable.id });

      return {
        before: { activeSessions: deleted.length },
        after: { activeSessions: 0 },
        reason: parsed.data.reason,
        metadata: { targetEmail: target.email, deletedCount: deleted.length },
        result: { ok: true, deletedSessions: deleted.length },
      };
    },
  );

  return NextResponse.json(result);
}
