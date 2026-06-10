/**
 * UsageClient — table per-user usage với filter date range + provider + feature.
 *
 * Export CSV: download URL fetch /api/admin/ai/usage?format=csv với cùng filter.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Download, Loader2, Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';

type Row = {
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

type Filter = {
  from: string;
  to: string;
  provider: string;
  feature: string;
  userEmail: string;
};

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function UsageClient() {
  const r = defaultRange();
  const [filter, setFilter] = React.useState<Filter>({
    from: r.from,
    to: r.to,
    provider: '',
    feature: '',
    userEmail: '',
  });
  const [debouncedEmail, setDebouncedEmail] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedEmail(filter.userEmail.trim()), 300);
    return () => clearTimeout(t);
  }, [filter.userEmail]);

  const buildQuery = (format: 'json' | 'csv' = 'json') => {
    const p = new URLSearchParams();
    // Convert YYYY-MM-DD → ISO ở Z midnight UTC
    if (filter.from) p.set('from', new Date(filter.from + 'T00:00:00Z').toISOString());
    if (filter.to) p.set('to', new Date(filter.to + 'T23:59:59Z').toISOString());
    if (filter.provider) p.set('provider', filter.provider);
    if (filter.feature) p.set('feature', filter.feature);
    if (debouncedEmail) p.set('userEmail', debouncedEmail);
    if (format === 'csv') p.set('format', 'csv');
    p.set('limit', '500');
    return p.toString();
  };

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.adminAiUsage(
      JSON.stringify({
        from: filter.from,
        to: filter.to,
        provider: filter.provider,
        feature: filter.feature,
        email: debouncedEmail,
      }),
    ),
    queryFn: () =>
      apiGet<{ rows: Row[]; totalCostUsd: number; totalCalls: number }>(
        `/api/admin/ai/usage?${buildQuery()}`,
      ),
  });
  const rows = data?.rows ?? [];
  const summary = {
    totalCostUsd: data?.totalCostUsd ?? 0,
    totalCalls: data?.totalCalls ?? 0,
  };

  const exportCsv = () => {
    window.location.href = `/api/admin/ai/usage?${buildQuery('csv')}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Usage by user</h1>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0 || loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11.5px] font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
        <p className="text-sm text-slate-400">
          Cost + token breakdown per user. Filter theo date / provider / feature rồi
          xuất CSV để phân tích offline.
        </p>
      </header>

      {/* Filter bar */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <DateInput
          label="Từ"
          value={filter.from}
          onChange={(v) => setFilter((f) => ({ ...f, from: v }))}
        />
        <DateInput
          label="Đến"
          value={filter.to}
          onChange={(v) => setFilter((f) => ({ ...f, to: v }))}
        />
        <TextInput
          label="Provider"
          value={filter.provider}
          onChange={(v) => setFilter((f) => ({ ...f, provider: v }))}
          placeholder="openai / anthropic…"
        />
        <TextInput
          label="Feature"
          value={filter.feature}
          onChange={(v) => setFilter((f) => ({ ...f, feature: v }))}
          placeholder="ragChat / quizGen…"
        />
        <TextInput
          label="Email"
          value={filter.userEmail}
          onChange={(v) => setFilter((f) => ({ ...f, userEmail: v }))}
          placeholder="substring…"
          icon
        />
      </div>

      {/* Summary line */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-slate-800/60 bg-slate-900/30 px-4 py-2 text-[12px]">
        <span>
          <span className="text-slate-500">Total cost: </span>
          <span className="font-mono font-semibold tabular-nums text-slate-100">
            ${summary.totalCostUsd.toFixed(2)}
          </span>
        </span>
        <span>
          <span className="text-slate-500">Total calls: </span>
          <span className="font-mono font-semibold tabular-nums text-slate-100">
            {summary.totalCalls.toLocaleString('vi-VN')}
          </span>
        </span>
        <span>
          <span className="text-slate-500">Users: </span>
          <span className="font-mono font-semibold tabular-nums text-slate-100">
            {rows.length}
          </span>
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
        <table className="w-full text-[12.5px]">
          <thead className="bg-slate-900/60">
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2.5">User</th>
              <th className="px-3 py-2.5">Plan</th>
              <th className="px-3 py-2.5 text-right">Cost</th>
              <th className="px-3 py-2.5 text-right">Calls</th>
              <th className="px-3 py-2.5 text-right">Tokens in</th>
              <th className="px-3 py-2.5 text-right">Tokens out</th>
              <th className="px-3 py-2.5 text-right">Cache hit</th>
              <th className="px-3 py-2.5">Last call</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-xs text-slate-500">
                  Không có data trong khoảng này.
                </td>
              </tr>
            ) : (
              rows.map((u) => <UserRow key={u.userId} u={u} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({ u }: { u: Row }) {
  return (
    <tr className="border-b border-slate-800/40 transition-colors hover:bg-slate-800/40">
      <td className="px-3 py-2">
        <Link
          href={`/admin/users/${u.userId}`}
          className="flex flex-col leading-tight text-slate-100 hover:text-red-300"
        >
          <span className="truncate text-[12px]">{u.name ?? '—'}</span>
          <span className="truncate font-mono text-[10px] text-slate-500">
            {u.email}
          </span>
        </Link>
      </td>
      <td className="px-3 py-2">
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
      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-slate-200">
        ${u.costUsd.toFixed(3)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-slate-300">
        {u.callCount.toLocaleString('vi-VN')}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-slate-400">
        {u.tokensIn.toLocaleString('vi-VN')}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-slate-400">
        {u.tokensOut.toLocaleString('vi-VN')}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-emerald-400">
        {u.cacheHits.toLocaleString('vi-VN')}
      </td>
      <td className="px-3 py-2 font-mono text-[10.5px] tabular-nums text-slate-500">
        {u.lastCallAt
          ? new Date(u.lastCallAt).toLocaleString('vi-VN', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '—'}
      </td>
    </tr>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 h-8 w-full rounded-md border border-slate-800 bg-slate-900 px-2 text-[12px] text-slate-100 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
      />
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <div className="relative mt-0.5">
        {icon && (
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'h-8 w-full rounded-md border border-slate-800 bg-slate-900 pr-7 text-[12px] text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20',
            icon ? 'pl-7' : 'pl-2',
          )}
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  );
}
