/**
 * GET /api/admin/groups — list study groups cross-user với filter.
 *
 * Query params:
 *   q          — substring trong group name
 *   status     — 'active' | 'suspended' | 'public'
 *   cursor     — createdAt ISO
 *   limit      — default 50, max 100
 *
 * Trả về kèm memberCount + ownerName/email.
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, ilike, isNotNull, isNull, lt, sql } from 'drizzle-orm';

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
  const q = url.searchParams.get('q')?.trim() ?? '';
  const status = url.searchParams.get('status');
  const cursor = url.searchParams.get('cursor');
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 50;

  const conditions = [] as Parameters<typeof and>[number][];
  if (q) conditions.push(ilike(studyGroup.name, `%${q}%`));
  if (status === 'active') conditions.push(isNull(studyGroup.suspendedAt));
  else if (status === 'suspended') conditions.push(isNotNull(studyGroup.suspendedAt));
  else if (status === 'public') conditions.push(eq(studyGroup.isPublic, true));
  if (cursor) {
    const parsed = new Date(cursor);
    if (!Number.isNaN(parsed.getTime())) {
      conditions.push(lt(studyGroup.createdAt, parsed));
    }
  }

  const rows = await db
    .select({
      id: studyGroup.id,
      name: studyGroup.name,
      description: studyGroup.description,
      iconUrl: studyGroup.iconUrl,
      isPublic: studyGroup.isPublic,
      maxMembers: studyGroup.maxMembers,
      suspendedAt: studyGroup.suspendedAt,
      suspendReason: studyGroup.suspendReason,
      createdAt: studyGroup.createdAt,
      ownerId: studyGroup.ownerUserId,
      ownerName: user.name,
      ownerEmail: user.email,
      memberCount: sql<number>`(
        SELECT COUNT(*)::int FROM "study_group_member"
        WHERE "study_group_member".group_id = ${studyGroup.id}
      )`,
    })
    .from(studyGroup)
    .leftJoin(user, eq(user.id, studyGroup.ownerUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(studyGroup.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && trimmed.length > 0
      ? trimmed[trimmed.length - 1]!.createdAt.toISOString()
      : null;

  let total: number | null = null;
  if (conditions.length === 0) {
    const [r] = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM "study_group"`,
    );
    total = Number(r?.n ?? 0);
  }

  return NextResponse.json({
    groups: trimmed.map((g) => ({
      ...g,
      createdAt: g.createdAt.toISOString(),
      suspendedAt: g.suspendedAt?.toISOString() ?? null,
    })),
    nextCursor,
    total,
  });
}
