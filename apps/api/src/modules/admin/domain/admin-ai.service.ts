import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { CircuitBreakerService } from '../../../infra/ai/circuit-breaker.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import { clampLimit } from './dto/admin-domain.dto';

const MAX_DAYS = 90;

type UsageRow = {
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
};

@Injectable()
export class AdminAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly audit: AdminAuditService,
  ) {}

  async listCircuits() {
    const circuits = await this.circuitBreaker.listCircuits();
    return { circuits };
  }

  async resetCircuit(ctx: AdminContext, name: string, reason: string) {
    await this.audit.withAudit(ctx, 'circuit.reset', { type: 'circuit', id: name }, async () => {
      await this.circuitBreaker.resetCircuit(name);
      return {
        before: { state: 'OPEN_OR_HALF_OPEN' },
        after: { state: 'CLOSED' },
        reason,
        result: { ok: true },
      };
    });

    return { ok: true };
  }

  async cost(daysParam: string | undefined) {
    const daysRaw = Number(daysParam ?? 30);
    const days = Number.isFinite(daysRaw)
      ? Math.min(MAX_DAYS, Math.max(1, Math.floor(daysRaw)))
      : 30;

    const cutoff = Prisma.sql`NOW() - (${days}::int * INTERVAL '1 day')`;

    const [summary, byDay, byProvider, byFeature, topUsers] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          total_usd: number;
          call_count: number;
          cache_hit_count: number;
          unique_users: number;
        }>
      >(Prisma.sql`
        SELECT
          COALESCE(SUM(cost_usd), 0)::float AS total_usd,
          COUNT(*)::int AS call_count,
          COUNT(*) FILTER (WHERE cached = true)::int AS cache_hit_count,
          COUNT(DISTINCT user_id)::int AS unique_users
        FROM "ai_usage_log"
        WHERE created_at >= ${cutoff}
      `),
      this.prisma.$queryRaw<
        Array<{ day: string; provider: string; cost_usd: number; call_count: number }>
      >(Prisma.sql`
        SELECT
          TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
          provider,
          COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
          COUNT(*)::int AS call_count
        FROM "ai_usage_log"
        WHERE created_at >= ${cutoff}
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `),
      this.prisma.$queryRaw<
        Array<{ provider: string; cost_usd: number; call_count: number }>
      >(Prisma.sql`
        SELECT
          provider,
          COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
          COUNT(*)::int AS call_count
        FROM "ai_usage_log"
        WHERE created_at >= ${cutoff}
        GROUP BY 1
        ORDER BY cost_usd DESC
      `),
      this.prisma.$queryRaw<
        Array<{ feature: string | null; cost_usd: number; call_count: number }>
      >(Prisma.sql`
        SELECT
          feature,
          COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
          COUNT(*)::int AS call_count
        FROM "ai_usage_log"
        WHERE created_at >= ${cutoff} AND feature IS NOT NULL
        GROUP BY 1
        ORDER BY cost_usd DESC
        LIMIT 20
      `),
      this.prisma.$queryRaw<
        Array<{
          user_id: string;
          name: string | null;
          email: string;
          plan: string;
          cost_usd: number;
          call_count: number;
        }>
      >(Prisma.sql`
        SELECT
          l.user_id,
          u.name,
          u.email,
          u.plan,
          COALESCE(SUM(l.cost_usd), 0)::float AS cost_usd,
          COUNT(*)::int AS call_count
        FROM "ai_usage_log" l
        JOIN "user" u ON u.id = l.user_id
        WHERE l.created_at >= ${cutoff}
        GROUP BY l.user_id, u.name, u.email, u.plan
        ORDER BY cost_usd DESC
        LIMIT 20
      `),
    ]);

    const s = summary[0] ?? {
      total_usd: 0,
      call_count: 0,
      cache_hit_count: 0,
      unique_users: 0,
    };
    const totalCost = Number(s.total_usd) || 0;

    return {
      days,
      summary: {
        totalUsd: totalCost,
        callCount: Number(s.call_count) || 0,
        cacheHitCount: Number(s.cache_hit_count) || 0,
        cacheHitRatio:
          Number(s.call_count) > 0 ? Number(s.cache_hit_count) / Number(s.call_count) : 0,
        uniqueUsers: Number(s.unique_users) || 0,
      },
      byDay: byDay.map((r) => ({
        day: r.day,
        provider: r.provider,
        costUsd: Number(r.cost_usd) || 0,
        callCount: Number(r.call_count) || 0,
      })),
      byProvider: byProvider.map((r) => ({
        provider: r.provider,
        costUsd: Number(r.cost_usd) || 0,
        callCount: Number(r.call_count) || 0,
        share: totalCost > 0 ? Number(r.cost_usd) / totalCost : 0,
      })),
      byFeature: byFeature.map((r) => ({
        feature: r.feature,
        costUsd: Number(r.cost_usd) || 0,
        callCount: Number(r.call_count) || 0,
      })),
      topUsers: topUsers.map((r) => ({
        userId: r.user_id,
        name: r.name,
        email: r.email,
        plan: r.plan,
        costUsd: Number(r.cost_usd) || 0,
        callCount: Number(r.call_count) || 0,
      })),
    };
  }

  async usage(params: {
    from?: string;
    to?: string;
    provider?: string;
    feature?: string;
    userEmail?: string;
    format?: string;
    limit?: string;
  }): Promise<
    { kind: 'csv'; csv: string; filename: string } | { kind: 'json'; body: Record<string, unknown> }
  > {
    const userEmail = params.userEmail?.trim() ?? '';
    const limit = clampLimit(params.limit, 200, 1000);
    const from = parseDate(params.from) ?? defaultFrom();
    const to = parseDate(params.to) ?? new Date();

    const conds: Prisma.Sql[] = [
      Prisma.sql`l.created_at >= ${from}`,
      Prisma.sql`l.created_at < ${to}`,
    ];
    if (params.provider) conds.push(Prisma.sql`l.provider = ${params.provider}`);
    if (params.feature) conds.push(Prisma.sql`l.feature = ${params.feature}`);
    if (userEmail) conds.push(Prisma.sql`u.email ILIKE ${'%' + userEmail + '%'}`);

    const rows = await this.prisma.$queryRaw<
      Array<{
        user_id: string | null;
        name: string | null;
        email: string;
        plan: string;
        cost_usd: number;
        call_count: number;
        tokens_in: number;
        tokens_out: number;
        cache_hits: number;
        last_call_at: string;
      }>
    >(Prisma.sql`
      SELECT
        l.user_id,
        u.name,
        u.email,
        u.plan,
        COALESCE(SUM(l.cost_usd), 0)::float AS cost_usd,
        COUNT(*)::int AS call_count,
        COALESCE(SUM(l.tokens_in), 0)::int AS tokens_in,
        COALESCE(SUM(l.tokens_out), 0)::int AS tokens_out,
        COUNT(*) FILTER (WHERE l.cached = true)::int AS cache_hits,
        MAX(l.created_at)::text AS last_call_at
      FROM "ai_usage_log" l
      JOIN "user" u ON u.id = l.user_id
      WHERE ${Prisma.join(conds, ' AND ')}
      GROUP BY l.user_id, u.name, u.email, u.plan
      ORDER BY COALESCE(SUM(l.cost_usd), 0) DESC
      LIMIT ${limit}
    `);

    const items: UsageRow[] = rows.map((r) => ({
      userId: r.user_id ?? '',
      name: r.name,
      email: r.email,
      plan: r.plan,
      costUsd: Number(r.cost_usd) || 0,
      callCount: Number(r.call_count) || 0,
      tokensIn: Number(r.tokens_in) || 0,
      tokensOut: Number(r.tokens_out) || 0,
      cacheHits: Number(r.cache_hits) || 0,
      lastCallAt: r.last_call_at,
    }));

    if ((params.format ?? 'json') === 'csv') {
      return {
        kind: 'csv',
        csv: toCsv(items, from, to),
        filename: `ai-usage-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`,
      };
    }

    const totalCost = items.reduce((s, i) => s + i.costUsd, 0);
    const totalCalls = items.reduce((s, i) => s + i.callCount, 0);

    return {
      kind: 'json',
      body: {
        rows: items,
        totalUsers: items.length,
        totalCostUsd: totalCost,
        totalCalls,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    };
  }
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function defaultFrom(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d;
}

function toCsv(items: UsageRow[], from: Date, to: Date): string {
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
