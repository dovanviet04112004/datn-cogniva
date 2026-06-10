/**
 * GET /api/admin/users — list users với filter + cursor pagination.
 *
 * Query params:
 *   q          — search substring (name OR email)
 *   plan       — filter FREE | PRO | TEAM
 *   status     — filter 'active' | 'suspended'
 *   adminOnly  — '1' để chỉ user có adminRole
 *   cursor     — pagination: createdAt ISO của row cuối trang trước
 *   limit      — số row trả về (max 100, default 50)
 *
 * Response:
 *   {
 *     users: Array<{ id, name, email, plan, isPublic, adminRole, suspendedAt, createdAt, lastSignInAt? }>,
 *     nextCursor: string | null  // createdAt ISO của row cuối → pass tiếp
 *   }
 *
 * Auth: requireAdminRole — mọi role (SUPER_ADMIN/ADMIN/SUPPORT) đều xem được.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, ilike, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { db, user } from '@cogniva/db';

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
  const plan = url.searchParams.get('plan');
  const status = url.searchParams.get('status');
  const adminOnly = url.searchParams.get('adminOnly') === '1';
  const cursor = url.searchParams.get('cursor');
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 50;

  // ── Build WHERE conditions ────────────────────────────
  const conditions = [] as Parameters<typeof and>[number][];
  if (q) {
    // ilike substring trên name OR email — không full-text vì dataset nhỏ
    conditions.push(
      or(ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`))!,
    );
  }
  if (plan && (plan === 'FREE' || plan === 'PRO' || plan === 'TEAM')) {
    conditions.push(eq(user.plan, plan));
  }
  if (status === 'active') {
    conditions.push(isNull(user.suspendedAt));
  } else if (status === 'suspended') {
    conditions.push(isNotNull(user.suspendedAt));
  }
  if (adminOnly) {
    conditions.push(isNotNull(user.adminRole));
  }
  if (cursor) {
    const parsed = new Date(cursor);
    if (!Number.isNaN(parsed.getTime())) {
      conditions.push(lt(user.createdAt, parsed));
    }
  }

  // ── Query — order by createdAt DESC (newest first), limit+1 để biết hasMore ──
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      plan: user.plan,
      isPublic: user.isPublic,
      adminRole: user.adminRole,
      suspendedAt: user.suspendedAt,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(user.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && trimmed.length > 0
    ? trimmed[trimmed.length - 1]!.createdAt.toISOString()
    : null;

  // ── Aggregate total đơn giản — chỉ count khi không có filter (cache UI) ──
  let total: number | null = null;
  if (conditions.length === 0) {
    const [row] = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM "user"`,
    );
    total = Number(row?.n ?? 0);
  }

  return NextResponse.json({
    users: trimmed.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
      suspendedAt: u.suspendedAt?.toISOString() ?? null,
    })),
    nextCursor,
    total,
  });
}
