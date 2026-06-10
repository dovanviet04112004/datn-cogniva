/**
 * POST /api/admin/impersonate — start impersonation (Phase 6 V1).
 *
 * Body:
 *   userId: target user ID
 *   reason: string (10..500)
 *   durationMin?: 5..60 (default 30)
 *
 * Logic:
 *   - Audit log entry 'impersonation.start' với sessionId tracking
 *   - Set signed cookie 'cogniva-imp' { adminId, targetUserId, expiresAt, mode='readonly' }
 *   - Phase 6 V1 KHÔNG swap session — chỉ marker để banner + readonly enforce
 *
 * DELETE /api/admin/impersonate — stop, clear cookie + audit.
 *
 * Auth: SUPER_ADMIN / ADMIN
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, user } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';
import {
  clearImpersonationCookie,
  getImpersonation,
  setImpersonationCookie,
} from '@/lib/admin/impersonation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BODY_SCHEMA = z.object({
  userId: z.string().min(1),
  reason: z.string().trim().min(10).max(500),
  durationMin: z.number().int().min(5).max(60).optional(),
});

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN', 'ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { userId, reason, durationMin } = parsed.data;

  if (userId === admin.userId) {
    return NextResponse.json(
      { error: 'Không thể impersonate chính mình' },
      { status: 400 },
    );
  }

  // Verify target user tồn tại + KHÔNG phải SUPER_ADMIN khác (privilege check)
  const [target] = await db
    .select({
      id: user.id,
      email: user.email,
      adminRole: user.adminRole,
      suspendedAt: user.suspendedAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: 'Target user không tồn tại' }, { status: 404 });
  }
  if (target.adminRole === 'SUPER_ADMIN' && admin.role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'Không thể impersonate SUPER_ADMIN' },
      { status: 403 },
    );
  }

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  // Audit trước, set cookie sau — nếu audit fail không impersonate
  await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'impersonation.start',
    { type: 'user', id: userId },
    async () => {
      await setImpersonationCookie({
        adminId: admin.userId,
        adminEmail: admin.email,
        targetUserId: target.id,
        targetEmail: target.email,
        mode: 'readonly',
        durationMin,
      });
      return {
        before: null,
        after: {
          targetUserId: target.id,
          targetEmail: target.email,
          mode: 'readonly',
          durationMin: durationMin ?? 30,
        },
        reason,
        result: { ok: true },
      };
    },
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN', 'ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const current = await getImpersonation();
  if (!current) {
    await clearImpersonationCookie();
    return NextResponse.json({ ok: true, wasActive: false });
  }

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'impersonation.stop',
    { type: 'user', id: current.targetUserId },
    async () => {
      await clearImpersonationCookie();
      return {
        before: { sessionId: current.sessionId, targetUserId: current.targetUserId },
        after: null,
        reason: 'Admin chủ động stop',
        result: { ok: true },
      };
    },
  );

  return NextResponse.json({ ok: true, wasActive: true });
}
