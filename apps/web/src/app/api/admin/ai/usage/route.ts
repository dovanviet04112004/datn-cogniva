/**
 * GET /api/admin/ai/usage — per-user usage breakdown.
 *
 * Query params:
 *   from        — ISO date (default: 30d ago)
 *   to          — ISO date (default: now)
 *   provider    — filter exact match (optional)
 *   feature     — filter exact match (optional)
 *   userEmail   — substring filter (optional)
 *   format      — 'json' (default) | 'csv'
 *   limit       — default 200, max 1000
 *
 * Response JSON:
 *   { rows: [...], totalUsers, totalCostUsd, totalCalls }
 *
 * Response CSV: text/csv với header row, dùng cho export Excel.
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, gte, ilike, lt, sql } from 'drizzle-orm';

import { aiUsageLog, db, user } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 1000;

export async function GET(request: Request) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const url = new URL(request.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const provider = url.searchParams.get('provider');
  const feature = url.searchParams.get('feature');
  const userEmail = url.searchParams.get('userEmail')?.trim() ?? '';
  const format = url.searchParams.get('format') ?? 'json';
  const limitRaw = Number(url.searchParams.get('limit') ?? 200);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 200;

  const from = parseDate(fromParam) ?? defaultFrom();
  const to = parseDate(toParam) ?? new Date();

  // Build WHERE bằng drizzle typed builders để tránh sql.join interpolation issue.
  const conds = [
    gte(aiUsageLog.createdAt, from),
    lt(aiUsageLog.createdAt, to),
  ];
  if (provider) conds.push(eq(aiUsageLog.provider, provider));
  if (feature) conds.push(eq(aiUsageLog.feature, feature));
  if (userEmail) conds.push(ilike(user.email, `%${userEmail}%`));

  const rows = await db
    .select({
      userId: aiUsageLog.userId,
      name: user.name,
      email: user.email,
      plan: user.plan,
      costUsd: sql<number>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)::float`,
      callCount: sql<number>`COUNT(*)::int`,
      tokensIn: sql<number>`COALESCE(SUM(${aiUsageLog.tokensIn}), 0)::int`,
      tokensOut: sql<number>`COALESCE(SUM(${aiUsageLog.tokensOut}), 0)::int`,
      cacheHits: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLog.cached} = true)::int`,
      lastCallAt: sql<string>`MAX(${aiUsageLog.createdAt})::text`,
    })
    .from(aiUsageLog)
    .innerJoin(user, eq(user.id, aiUsageLog.userId))
    .where(and(...conds))
    .groupBy(aiUsageLog.userId, user.name, user.email, user.plan)
    .orderBy(desc(sql`COALESCE(SUM(${aiUsageLog.costUsd}), 0)`))
    .limit(limit);

  const items = rows.map((r) => ({
    userId: r.userId ?? '',
    name: r.name,
    email: r.email,
    plan: r.plan,
    costUsd: Number(r.costUsd) || 0,
    callCount: Number(r.callCount) || 0,
    tokensIn: Number(r.tokensIn) || 0,
    tokensOut: Number(r.tokensOut) || 0,
    cacheHits: Number(r.cacheHits) || 0,
    lastCallAt: r.lastCallAt,
  }));

  if (format === 'csv') {
    const csv = toCsv(items, from, to);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="ai-usage-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const totalCost = items.reduce((s, i) => s + i.costUsd, 0);
  const totalCalls = items.reduce((s, i) => s + i.callCount, 0);

  return NextResponse.json({
    rows: items,
    totalUsers: items.length,
    totalCostUsd: totalCost,
    totalCalls,
    from: from.toISOString(),
    to: to.toISOString(),
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

function toCsv(
  items: Array<{
    userId: string;
    name: string | null;
    email: string;
    plan: string;
    costUsd: number;
    callCount: number;
    tokensIn: number;
    tokensOut: number;
    cacheHits: number;
    lastCallAt: string;
  }>,
  from: Date,
  to: Date,
): string {
  const header = [
    'user_id',
    'name',
    'email',
    'plan',
    'cost_usd',
    'call_count',
    'tokens_in',
    'tokens_out',
    'cache_hits',
    'last_call_at',
    'window_from',
    'window_to',
  ].join(',');
  const escape = (v: string | number | null) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const lines = items.map((i) =>
    [
      i.userId,
      i.name ?? '',
      i.email,
      i.plan,
      i.costUsd.toFixed(6),
      i.callCount,
      i.tokensIn,
      i.tokensOut,
      i.cacheHits,
      i.lastCallAt ?? '',
      fromIso,
      toIso,
    ]
      .map(escape)
      .join(','),
  );
  return [header, ...lines].join('\n');
}
