/**
 * GET /api/admin/moderation/reports — list content reports với filter.
 *
 * Query params:
 *   status     — 'PENDING' | 'RESOLVED' (default 'PENDING')
 *   targetType — 'message' | 'user' | 'document' | 'group'
 *   cursor     — createdAt ISO
 *   limit      — default 50, max 100
 *
 * Trả về kèm reporter info để admin biết ai report. Resolved kèm resolver.
 */
import { NextResponse } from 'next/server';
import { aliasedTable, and, desc, eq, lt, sql } from 'drizzle-orm';

import { contentReport, db, user } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;

// Alias bảng user để join 2 lần (reporter + resolver)
const reporterUser = aliasedTable(user, 'reporter');
const resolverUser = aliasedTable(user, 'resolver');

export async function GET(request: Request) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'PENDING';
  const targetType = url.searchParams.get('targetType');
  const cursor = url.searchParams.get('cursor');
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 50;

  const conditions = [eq(contentReport.status, status)];
  if (targetType) conditions.push(eq(contentReport.targetType, targetType));
  if (cursor) {
    const parsed = new Date(cursor);
    if (!Number.isNaN(parsed.getTime())) {
      conditions.push(lt(contentReport.createdAt, parsed));
    }
  }

  const rows = await db
    .select({
      id: contentReport.id,
      reporterId: contentReport.reporterId,
      reporterName: reporterUser.name,
      reporterEmail: reporterUser.email,
      targetType: contentReport.targetType,
      targetId: contentReport.targetId,
      reason: contentReport.reason,
      status: contentReport.status,
      resolvedBy: contentReport.resolvedBy,
      resolverName: resolverUser.name,
      resolverEmail: resolverUser.email,
      resolvedAt: contentReport.resolvedAt,
      resolution: contentReport.resolution,
      createdAt: contentReport.createdAt,
    })
    .from(contentReport)
    .leftJoin(reporterUser, eq(reporterUser.id, contentReport.reporterId))
    .leftJoin(resolverUser, eq(resolverUser.id, contentReport.resolvedBy))
    .where(and(...conditions))
    .orderBy(desc(contentReport.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && trimmed.length > 0
      ? trimmed[trimmed.length - 1]!.createdAt.toISOString()
      : null;

  // Count: pending để badge sidebar (Phase 2 follow-up: realtime badge)
  const [pending] = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM "content_report" WHERE status = 'PENDING'`,
  );

  return NextResponse.json({
    reports: trimmed.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    })),
    nextCursor,
    pendingCount: Number(pending?.n ?? 0),
  });
}
