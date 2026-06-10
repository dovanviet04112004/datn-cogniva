/**
 * GET /api/admin/users/[id] — chi tiết 1 user + stats overview.
 *
 * Response gồm:
 *   - user: tất cả field hữu ích (KHÔNG bao gồm hashed_password, …)
 *   - stats: docs/conversations/flashcards/quizAttempts/groups/xp/streak counts
 *   - recentAudit: 10 audit log entry tác động lên user này
 *
 * PATCH /api/admin/users/[id] — update name/plan/isPublic.
 * Body: { name?, plan?, isPublic? } — bất kỳ field nào set sẽ update.
 *
 * Mọi mutation đi qua withAudit() để log.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  conversation,
  db,
  document,
  flashcard,
  studyGroupMember,
  user,
  userStats,
  adminAuditLog,
} from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';
import { onProfileChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;

  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      plan: user.plan,
      isPublic: user.isPublic,
      preferences: user.preferences,
      adminRole: user.adminRole,
      suspendedAt: user.suspendedAt,
      suspendReason: user.suspendReason,
      parentalConsentStatus: user.parentalConsentStatus,
      dateOfBirth: user.dateOfBirth,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .where(eq(user.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Parallel counters
  const [
    [docs],
    [conv],
    [fc],
    [grp],
    [stats],
    recentAudit,
  ] = await Promise.all([
    db.select({ n: count(document.id) }).from(document).where(eq(document.userId, id)),
    db.select({ n: count(conversation.id) }).from(conversation).where(eq(conversation.userId, id)),
    db.select({ n: count(flashcard.id) }).from(flashcard).where(eq(flashcard.userId, id)),
    db
      .select({ n: count(studyGroupMember.userId) })
      .from(studyGroupMember)
      .where(eq(studyGroupMember.userId, id)),
    db
      .select({
        xp: userStats.xp,
        currentStreak: userStats.currentStreak,
        longestStreak: userStats.longestStreak,
        lastActivityDate: userStats.lastActivityDate,
      })
      .from(userStats)
      .where(eq(userStats.userId, id))
      .limit(1),
    db
      .select({
        id: adminAuditLog.id,
        action: adminAuditLog.action,
        adminId: adminAuditLog.adminId,
        payload: adminAuditLog.payload,
        createdAt: adminAuditLog.createdAt,
      })
      .from(adminAuditLog)
      .where(
        and(eq(adminAuditLog.targetType, 'user'), eq(adminAuditLog.targetId, id)),
      )
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(10),
  ]);

  return NextResponse.json({
    user: {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      dateOfBirth: row.dateOfBirth?.toISOString() ?? null,
    },
    stats: {
      docs: docs?.n ?? 0,
      conversations: conv?.n ?? 0,
      flashcards: fc?.n ?? 0,
      groups: grp?.n ?? 0,
      xp: stats?.xp ?? 0,
      currentStreak: stats?.currentStreak ?? 0,
      longestStreak: stats?.longestStreak ?? 0,
      lastActivityDate: stats?.lastActivityDate ?? null,
    },
    recentAudit: recentAudit.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

const PATCH_SCHEMA = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  plan: z.enum(['FREE', 'PRO', 'TEAM']).optional(),
  isPublic: z.boolean().optional(),
  reason: z.string().trim().min(5).max(500),
});

export async function PATCH(request: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN', 'ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, plan, isPublic, reason } = parsed.data;
  if (name === undefined && plan === undefined && isPublic === undefined) {
    return NextResponse.json({ error: 'Không có field nào để update' }, { status: 400 });
  }

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'user.update',
    { type: 'user', id },
    async () => {
      const [before] = await db
        .select({ name: user.name, plan: user.plan, isPublic: user.isPublic })
        .from(user)
        .where(eq(user.id, id))
        .limit(1);
      if (!before) throw new Error('User not found');

      const update: Record<string, unknown> = {};
      if (name !== undefined) update.name = name;
      if (plan !== undefined) update.plan = plan;
      if (isPublic !== undefined) update.isPublic = isPublic;
      update.updatedAt = new Date();

      const [after] = await db
        .update(user)
        .set(update)
        .where(eq(user.id, id))
        .returning({
          name: user.name,
          plan: user.plan,
          isPublic: user.isPublic,
        });

      // Admin đổi name/plan/isPublic → bust cache profile (me + public) của user đó.
      await onProfileChanged(id);
      return { before, after, reason, result: { ok: true, after } };
    },
  );

  return NextResponse.json(result);
}
