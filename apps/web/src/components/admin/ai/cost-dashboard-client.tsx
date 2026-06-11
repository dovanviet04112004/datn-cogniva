'use client';

import * as React from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, Coins, Database, Loader2, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';

type ByDay = { day: string; provider: string; costUsd: number; callCount: number };
type ByProvider = {
  provider: string;
  costUsd: number;
  callCount: number;
  share: number;
};
type ByFeature = { feature: string | null; costUsd: number; callCount: number };
type TopUser = {
  userId: string;
  name: string | null;
  email: string;
  plan: string;
  costUsd: number;
  callCount: number;
};

type Data = {
  days: number;
  summary: {
    totalUsd: number;
    callCount: number;
    cacheHitCount: number;
    cacheHitRatio: number;
    uniqueUsers: number;
  };
  byDay: ByDay[];
  byProvider: ByProvider[];
  byFeature: ByFeature[];
  topUsers: TopUser[];
};

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10b981',
  anthropic: '#f59e0b',
  google: '#3b82f6',
  voyage: '#a855f7',
  cohere: '#ec4899',
  groq: '#ef4444',
  unknown: '#64748b',
};

function colorFor(provider: string): string {
  return PROVIDER_COLORS[provider] ?? '#64748b';
}

export function CostDashboardClient() {
  const [days, setDays] = React.useState<7 | 30 | 90>(30);

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.adminAiCost(String(days)),
    queryFn: () => apiGet<Data>(`/api/admin/ai/cost?days=${days}`),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">AI Cost dashboard</h1>
          <div className="flex items-center gap-1">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  days === d
                    ? 'bg-red-500/10 text-red-300 ring-1 ring-inset ring-red-500/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
                )}
              >
                {d} ngày
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-slate-400">
          Cost breakdown từ <code>ai_usage_log</code>. Số liệu cập nhật ngay sau mỗi LLM call.
        </p>
      </header>

      {loading || !data ? (
        <div className="py-12 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
        </div>
      ) : data.summary.callCount === 0 ? (
        <EmptyState days={days} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KpiTile
              icon={Coins}
              label="Total cost"
              value={`$${data.summary.totalUsd.toFixed(2)}`}
              hint={`${data.days} ngày`}
            />
            <KpiTile
              icon={Activity}
              label="LLM calls"
              value={data.summary.callCount.toLocaleString('vi-VN')}
              hint={`${data.summary.callCount > 0 ? (data.summary.totalUsd / data.summary.callCount).toFixed(5) : '0'} $/call`}
            />
            <KpiTile
              icon={Database}
              label="Cache hit"
              value={`${(data.summary.cacheHitRatio * 100).toFixed(1)}%`}
              hint={`${data.summary.cacheHitCount.toLocaleString('vi-VN')} hits`}
            />
            <KpiTile
              icon={Users}
              label="Unique users"
              value={data.summary.uniqueUsers.toLocaleString('vi-VN')}
              hint={`${data.summary.uniqueUsers > 0 ? (data.summary.totalUsd / data.summary.uniqueUsers).toFixed(3) : '0'} $/user`}
            />
          </div>

          <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
            <h2 className="mb-4 text-sm font-semibold tracking-tight">Cost theo ngày (USD)</h2>
            <LineChart byDay={data.byDay} days={data.days} />
            <ProviderLegend providers={data.byProvider.map((p) => p.provider)} />
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
            <h2 className="mb-3 text-sm font-semibold tracking-tight">By provider</h2>
            <ProviderBar items={data.byProvider} total={data.summary.totalUsd} />
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
              <h2 className="mb-3 text-sm font-semibold tracking-tight">By feature</h2>
              <FeatureTable items={data.byFeature} />
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
              <h2 className="mb-3 text-sm font-semibold tracking-tight">Top 20 users</h2>
              <TopUserTable items={data.topUsers} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ days }: { days: number }) {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-center">
      <AlertTriangle className="mx-auto h-6 w-6 text-amber-400" />
      <p className="mt-2 text-sm font-medium text-amber-200">
        Chưa có data AI usage trong {days} ngày qua
      </p>
      <p className="mt-1 text-[12px] text-slate-400">
        Bảng <code>ai_usage_log</code> trống — hoặc Phase 3 mới wire xong và chưa có LLM call nào
        ghi vào DB. Gửi 1 chat AI để verify.
      </p>
    </div>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="mt-1 text-lg font-semibold tracking-tight text-slate-100">{value}</p>
      {hint && <p className="font-mono text-[10.5px] text-slate-500">{hint}</p>}
    </div>
  );
}

function LineChart({ byDay, days }: { byDay: ByDay[]; days: number }) {
  const dayMap = new Map<string, Map<string, number>>();
  for (const r of byDay) {
    if (!dayMap.has(r.day)) dayMap.set(r.day, new Map());
    dayMap.get(r.day)!.set(r.provider, r.costUsd);
  }
  const allDays = Array.from(dayMap.keys()).sort();
  const providers = Array.from(new Set(byDay.map((r) => r.provider))).sort();

  const filledDays = fillDays(allDays, days);
  const maxTotal = Math.max(
    0.01,
    ...filledDays.map((d) => providers.reduce((sum, p) => sum + (dayMap.get(d)?.get(p) ?? 0), 0)),
  );

  const W = 800;
  const H = 220;
  const padL = 50;
  const padR = 10;
  const padT = 10;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const xFor = (i: number) =>
    filledDays.length === 1 ? padL + innerW / 2 : padL + (i / (filledDays.length - 1)) * innerW;

  const lines = providers.map((p) => {
    const points = filledDays
      .map((d, i) => {
        const v = dayMap.get(d)?.get(p) ?? 0;
        const y = padT + innerH - (v / maxTotal) * innerH;
        return `${xFor(i).toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return { provider: p, points };
  });

  const yTicks = Array.from({ length: 5 }, (_, i) => i / 4).map((r) => ({
    y: padT + innerH - r * innerH,
    label: `$${(r * maxTotal).toFixed(maxTotal < 1 ? 3 : 2)}`,
  }));

  const xLabels =
    filledDays.length === 0
      ? []
      : filledDays.length <= 3
        ? filledDays.map((d, i) => ({ x: xFor(i), label: shortDate(d) }))
        : [
            { x: xFor(0), label: shortDate(filledDays[0]!) },
            {
              x: xFor(Math.floor(filledDays.length / 2)),
              label: shortDate(filledDays[Math.floor(filledDays.length / 2)]!),
            },
            {
              x: xFor(filledDays.length - 1),
              label: shortDate(filledDays[filledDays.length - 1]!),
            },
          ];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      preserveAspectRatio="none"
      style={{ maxHeight: 240 }}
    >
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL}
            y1={t.y}
            x2={W - padR}
            y2={t.y}
            stroke="rgb(30, 41, 59)"
            strokeWidth={1}
            strokeDasharray={i === 4 ? '' : '3,3'}
          />
          <text
            x={padL - 6}
            y={t.y + 3}
            textAnchor="end"
            className="fill-slate-500"
            style={{ fontSize: 10, fontFamily: 'monospace' }}
          >
            {t.label}
          </text>
        </g>
      ))}

      {lines.map((l) => (
        <polyline
          key={l.provider}
          points={l.points}
          fill="none"
          stroke={colorFor(l.provider)}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      {xLabels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={H - 8}
          textAnchor="middle"
          className="fill-slate-500"
          style={{ fontSize: 10, fontFamily: 'monospace' }}
        >
          {l.label}
        </text>
      ))}
    </svg>
  );
}

function ProviderLegend({ providers }: { providers: string[] }) {
  if (providers.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-800/60 pt-2">
      {providers.map((p) => (
        <span
          key={p}
          className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-slate-400"
        >
          <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: colorFor(p) }} />
          {p}
        </span>
      ))}
    </div>
  );
}

function ProviderBar({ items, total }: { items: ByProvider[]; total: number }) {
  if (items.length === 0) {
    return <p className="text-[11px] text-slate-500">Không có data.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((p) => (
        <li key={p.provider}>
          <div className="mb-1 flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1.5 font-medium text-slate-200">
              <span
                className="h-2.5 w-3 rounded-sm"
                style={{ backgroundColor: colorFor(p.provider) }}
              />
              {p.provider}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-slate-400">
              ${p.costUsd.toFixed(2)} · {p.callCount.toLocaleString('vi-VN')} calls ·{' '}
              {(p.share * 100).toFixed(1)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full"
              style={{
                width: `${total > 0 ? (p.costUsd / total) * 100 : 0}%`,
                backgroundColor: colorFor(p.provider),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function FeatureTable({ items }: { items: ByFeature[] }) {
  if (items.length === 0) {
    return <p className="text-[11px] text-slate-500">Chưa có feature tag.</p>;
  }
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <th className="py-1.5">Feature</th>
          <th className="py-1.5 text-right">Cost</th>
          <th className="py-1.5 text-right">Calls</th>
        </tr>
      </thead>
      <tbody>
        {items.map((f) => (
          <tr key={f.feature ?? 'null'} className="border-b border-slate-800/40">
            <td className="py-1.5 font-mono text-[11px] text-slate-300">
              {f.feature ?? <span className="italic text-slate-600">—</span>}
            </td>
            <td className="py-1.5 text-right font-mono text-[11px] tabular-nums text-slate-300">
              ${f.costUsd.toFixed(4)}
            </td>
            <td className="py-1.5 text-right font-mono text-[11px] tabular-nums text-slate-500">
              {f.callCount.toLocaleString('vi-VN')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TopUserTable({ items }: { items: TopUser[] }) {
  if (items.length === 0) {
    return <p className="text-[11px] text-slate-500">Chưa có user nào.</p>;
  }
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <th className="py-1.5">User</th>
          <th className="py-1.5">Plan</th>
          <th className="py-1.5 text-right">Cost</th>
          <th className="py-1.5 text-right">Calls</th>
        </tr>
      </thead>
      <tbody>
        {items.map((u) => (
          <tr key={u.userId} className="border-b border-slate-800/40">
            <td className="py-1.5">
              <Link
                href={`/admin/users/${u.userId}`}
                className="flex flex-col leading-tight text-slate-300 hover:text-red-300"
              >
                <span className="truncate text-[11.5px]">{u.name ?? '—'}</span>
                <span className="truncate font-mono text-[10px] text-slate-500">{u.email}</span>
              </Link>
            </td>
            <td className="py-1.5">
              <span
                className={cn(
                  'inline-flex rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold',
                  u.plan === 'TEAM'
                    ? 'bg-purple-500/10 text-purple-300'
                    : u.plan === 'PRO'
                      ? 'bg-blue-500/10 text-blue-300'
                      : 'bg-slate-700/30 text-slate-400',
                )}
              >
                {u.plan}
              </span>
            </td>
            <td className="py-1.5 text-right font-mono text-[11px] tabular-nums text-slate-200">
              ${u.costUsd.toFixed(3)}
            </td>
            <td className="py-1.5 text-right font-mono text-[11px] tabular-nums text-slate-500">
              {u.callCount.toLocaleString('vi-VN')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fillDays(have: string[], days: number): string[] {
  const result: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    result.push(d.toISOString().slice(0, 10));
  }
  for (const h of have) if (!result.includes(h)) result.push(h);
  return result.sort();
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
