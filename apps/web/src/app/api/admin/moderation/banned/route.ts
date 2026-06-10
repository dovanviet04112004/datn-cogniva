/**
 * GET /api/admin/moderation/banned — list mọi entity bị suspend.
 *
 * Query params:
 *   type    — 'user' | 'group' (default cả 2)
 *   q       — substring trong name/email (user) hoặc name (group)
 *   cursor  — suspendedAt ISO row cuối (per-type)
 *
 * Trả 2 mảng riêng: users + groups. UI render thành tabs.
 * Mỗi entry có suspendedAt + reason để admin biết tại sao bị ban.
 */
import { NextResponse } from 'next/server';
import { and, desc, ilike, isNotNull, or } from 'drizzle-orm';

import { db, studyGroup, user } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;

export async function GET(request: Request) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type'); // null = cả 2
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 50;

  // Users
  const usersPromise =
    type === 'group'
      ? Promise.resolve([])
      : db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            suspendedAt: user.suspendedAt,
            suspendReason: user.suspendReason,
            adminRole: user.adminRole,
          })
          .from(user)
          .where(
            q
              ? and(
                  isNotNull(user.suspendedAt),
                  or(ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`))!,
                )
              : isNotNull(user.suspendedAt),
          )
          .orderBy(desc(user.suspendedAt))
          .limit(limit);

  const groupsPromise =
    type === 'user'
      ? Promise.resolve([])
      : db
          .select({
            id: studyGroup.id,
            name: studyGroup.name,
            iconUrl: studyGroup.iconUrl,
            suspendedAt: studyGroup.suspendedAt,
            suspendReason: studyGroup.suspendReason,
            ownerUserId: studyGroup.ownerUserId,
          })
          .from(studyGroup)
          .where(
            q
              ? and(isNotNull(studyGroup.suspendedAt), ilike(studyGroup.name, `%${q}%`))
              : isNotNull(studyGroup.suspendedAt),
          )
          .orderBy(desc(studyGroup.suspendedAt))
          .limit(limit);

  const [users, groups] = await Promise.all([usersPromise, groupsPromise]);

  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      suspendedAt: u.suspendedAt?.toISOString() ?? null,
    })),
    groups: groups.map((g) => ({
      ...g,
      suspendedAt: g.suspendedAt?.toISOString() ?? null,
    })),
  });
}
