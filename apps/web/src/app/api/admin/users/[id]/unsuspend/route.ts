/**
 * POST /api/admin/users/[id]/unsuspend — restore user đã suspend.
 *
 * Body: { reason: string (10-500) }
 * Effect: clear suspended_at + suspend_reason, audit log.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, user } from '@cogniva/db';

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
  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'user.unsuspend',
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
      if (!before.suspendedAt) {
        throw new Error('User chưa bị suspend');
      }

      await db
        .update(user)
        .set({ suspendedAt: null, suspendReason: null, updatedAt: new Date() })
        .where(eq(user.id, id));

      return {
        before: {
          suspendedAt: before.suspendedAt.toISOString(),
          suspendReason: before.suspendReason,
        },
        after: { suspendedAt: null, suspendReason: null },
        reason: parsed.data.reason,
        metadata: { targetEmail: before.email },
        result: { ok: true },
      };
    },
  );

  return NextResponse.json(result);
}
