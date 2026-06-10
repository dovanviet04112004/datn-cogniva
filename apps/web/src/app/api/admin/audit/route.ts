/**
 * GET /api/admin/audit — list audit log với filter + cursor pagination.
 *
 * Query params:
 *   adminEmail  — substring filter (join user)
 *   action      — substring filter (vd 'user.suspend')
 *   targetType  — exact match ('user', 'document', 'group', …)
 *   targetId    — exact match
 *   from        — ISO date (default: 30d ago)
 *   to          — ISO date (default: now)
 *   cursor      — createdAt ISO row cuối
 *   limit       — default 50, max 100
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, gte, ilike, lt, sql } from 'drizzle-orm';

import { adminAuditLog, db, user } from '@cogniva/db';

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
  const adminEmail = url.searchParams.get('adminEmail')?.trim() ?? '';
  const action = url.searchParams.get('action')?.trim() ?? '';
  const targetType = url.searchParams.get('targetType')?.trim() ?? '';
  const targetId = url.searchParams.get('targetId')?.trim() ?? '';
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const cursor = url.searchParams.get('cursor');
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 50;

  const from = parseDate(fromParam) ?? defaultFrom();
  const to = parseDate(toParam) ?? new Date();

  const conditions = [
    gte(adminAuditLog.createdAt, from),
    lt(adminAuditLog.createdAt, to),
  ] as Parameters<typeof and>[number][];

  if (adminEmail) conditions.push(ilike(user.email, `%${adminEmail}%`));
  if (action) conditions.push(ilike(adminAuditLog.action, `%${action}%`));
  if (targetType) conditions.push(eq(adminAuditLog.targetType, targetType));
  if (targetId) conditions.push(eq(adminAuditLog.targetId, targetId));
  if (cursor) {
    const parsed = new Date(cursor);
    if (!Number.isNaN(parsed.getTime())) {
      conditions.push(lt(adminAuditLog.createdAt, parsed));
    }
  }

  const rows = await db
    .select({
      id: adminAuditLog.id,
      adminId: adminAuditLog.adminId,
      adminName: user.name,
      adminEmail: user.email,
      action: adminAuditLog.action,
      targetType: adminAuditLog.targetType,
      targetId: adminAuditLog.targetId,
      payload: adminAuditLog.payload,
      ip: adminAuditLog.ip,
      userAgent: adminAuditLog.userAgent,
      createdAt: adminAuditLog.createdAt,
    })
    .from(adminAuditLog)
    .leftJoin(user, eq(user.id, adminAuditLog.adminId))
    .where(and(...conditions))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && trimmed.length > 0
      ? trimmed[trimmed.length - 1]!.createdAt.toISOString()
      : null;

  // Distinct values cho filter dropdown (cached per-render, no DB hit nếu UI cache)
  const [actionsRaw, targetTypesRaw] = await Promise.all([
    db.execute<{ action: string }>(
      sql`SELECT DISTINCT action FROM "admin_audit_log" ORDER BY action LIMIT 50`,
    ),
    db.execute<{ target_type: string }>(
      sql`SELECT DISTINCT target_type FROM "admin_audit_log" ORDER BY target_type LIMIT 30`,
    ),
  ]);

  return NextResponse.json({
    entries: trimmed.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
    nextCursor,
    distinct: {
      actions: actionsRaw.map((r) => r.action),
      targetTypes: targetTypesRaw.map((r) => r.target_type),
    },
  });
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function defaultFrom(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d;
}
