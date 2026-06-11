'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Filter, Loader2, RefreshCw, X } from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';

type Entry = {
  id: string;
  adminId: string;
  adminName: string | null;
  adminEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payload: {
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

type Filter = {
  from: string;
  to: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
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

export function AuditLogClient() {
  const r = defaultRange();
  const [filter, setFilter] = React.useState<Filter>({
    from: r.from,
    to: r.to,
    adminEmail: '',
    action: '',
    targetType: '',
    targetId: '',
  });
  const [debounced, setDebounced] = React.useState(filter);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(filter), 300);
    return () => clearTimeout(t);
  }, [filter]);

  const buildQuery = (cursorParam?: string) => {
    const p = new URLSearchParams();
    if (debounced.from) p.set('from', new Date(debounced.from + 'T00:00:00Z').toISOString());
    if (debounced.to) p.set('to', new Date(debounced.to + 'T23:59:59Z').toISOString());
    if (debounced.adminEmail) p.set('adminEmail', debounced.adminEmail);
    if (debounced.action) p.set('action', debounced.action);
    if (debounced.targetType) p.set('targetType', debounced.targetType);
    if (debounced.targetId) p.set('targetId', debounced.targetId);
    if (cursorParam) p.set('cursor', cursorParam);
    p.set('limit', '50');
    return p.toString();
  };

  type Page = {
    entries: Entry[];
    nextCursor: string | null;
    distinct: { actions: string[]; targetTypes: string[] };
  };
  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: qk.adminAudit(JSON.stringify(debounced)),
    queryFn: ({ pageParam }) =>
      apiGet<Page>(`/api/admin/audit?${buildQuery(pageParam ?? undefined)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const entries = React.useMemo(() => data?.pages.flatMap((p) => p.entries) ?? [], [data]);
  const distinct = data?.pages[0]?.distinct ?? { actions: [], targetTypes: [] };
  const loadMore = () => {
    if (hasNextPage && !loadingMore) void fetchNextPage();
  };

  const resetFilter = () => {
    const r = defaultRange();
    setFilter({
      from: r.from,
      to: r.to,
      adminEmail: '',
      action: '',
      targetType: '',
      targetId: '',
    });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:bg-slate-800"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
        <p className="text-sm text-slate-400">
          Mọi mutation admin được ghi qua <code>withAudit()</code>. Click row để xem before/after
          diff + reason.
        </p>
      </header>

      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <Filter className="h-3 w-3" />
            Filter
          </h2>
          <button onClick={resetFilter} className="text-[11px] text-slate-500 hover:text-slate-300">
            Reset
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
            label="Admin email"
            value={filter.adminEmail}
            onChange={(v) => setFilter((f) => ({ ...f, adminEmail: v }))}
            placeholder="substring…"
          />
          <SelectOrText
            label="Action"
            value={filter.action}
            options={distinct.actions}
            onChange={(v) => setFilter((f) => ({ ...f, action: v }))}
          />
          <SelectOrText
            label="Target type"
            value={filter.targetType}
            options={distinct.targetTypes}
            onChange={(v) => setFilter((f) => ({ ...f, targetType: v }))}
            exact
          />
          <TextInput
            label="Target ID"
            value={filter.targetId}
            onChange={(v) => setFilter((f) => ({ ...f, targetId: v }))}
            placeholder="exact…"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2.5">Khi</th>
              <th className="px-3 py-2.5">Admin</th>
              <th className="px-3 py-2.5">Action</th>
              <th className="px-3 py-2.5">Target</th>
              <th className="px-3 py-2.5">Lý do</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-xs text-slate-500">
                  Không có audit entry nào khớp filter.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <React.Fragment key={e.id}>
                  <tr
                    className="cursor-pointer border-b border-slate-800/60 transition-colors hover:bg-slate-800/40"
                    onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  >
                    <td className="px-3 py-2 font-mono text-[10.5px] tabular-nums text-slate-400">
                      {new Date(e.createdAt).toLocaleString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/users/${e.adminId}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="flex flex-col leading-tight text-slate-300 hover:text-red-300"
                      >
                        <span className="truncate text-[11.5px]">{e.adminName ?? '—'}</span>
                        <span className="truncate font-mono text-[10px] text-slate-500">
                          {e.adminEmail ?? '—'}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <code className="font-mono text-[11px] text-slate-200">{e.action}</code>
                    </td>
                    <td className="px-3 py-2">
                      <TargetLink type={e.targetType} id={e.targetId} />
                    </td>
                    <td className="max-w-[300px] truncate px-3 py-2 text-[11.5px] text-slate-400">
                      {e.payload.reason ?? <span className="italic text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ChevronRight
                        className={cn(
                          'h-3.5 w-3.5 text-slate-500 transition-transform',
                          expanded === e.id && 'rotate-90',
                        )}
                      />
                    </td>
                  </tr>
                  {expanded === e.id && (
                    <tr className="bg-slate-950/60">
                      <td colSpan={6} className="px-4 py-3">
                        <DiffViewer payload={e.payload} ip={e.ip} ua={e.userAgent} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800',
              loadingMore && 'opacity-50',
            )}
          >
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Tải thêm
          </button>
        </div>
      )}
    </div>
  );
}

function DiffViewer({
  payload,
  ip,
  ua,
}: {
  payload: Entry['payload'];
  ip: string | null;
  ua: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <JsonPane label="Before" data={payload.before} />
        <JsonPane label="After" data={payload.after} />
      </div>
      {payload.metadata && Object.keys(payload.metadata).length > 0 && (
        <JsonPane label="Metadata" data={payload.metadata} />
      )}
      <div className="grid grid-cols-2 gap-2 font-mono text-[10.5px] text-slate-500">
        <p>
          IP: <span className="text-slate-400">{ip ?? '—'}</span>
        </p>
        <p className="truncate" title={ua ?? ''}>
          UA: <span className="text-slate-400">{ua ?? '—'}</span>
        </p>
      </div>
    </div>
  );
}

function JsonPane({ label, data }: { label: string; data: unknown }) {
  const empty = data === null || data === undefined;
  return (
    <div className="rounded-md border border-slate-800/60 bg-slate-950/60 p-2">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] text-slate-300">
        {empty ? '—' : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function TargetLink({ type, id }: { type: string; id: string }) {
  const map: Record<string, string> = {
    user: `/admin/users/${id}`,
    document: `/admin/documents/${id}`,
    conversation: `/admin/conversations/${id}`,
    group: `/admin/groups/${id}`,
    booking: `/admin/tutoring/bookings/${id}`,
    review: `/admin/tutoring/reviews`,
    report: `/admin/moderation/reports`,
    flag: `/admin/system/flags`,
    system: `/admin/system/${id}`,
  };
  const href = map[type];
  if (!href) {
    return (
      <span className="font-mono text-[10.5px] text-slate-500">
        {type}:{id.slice(0, 10)}
      </span>
    );
  }
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 font-mono text-[10.5px] text-red-300 hover:text-red-200"
    >
      <span className="text-slate-500">{type}:</span>
      {id.slice(0, 10)}
    </Link>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <div className="relative mt-0.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full rounded-md border border-slate-800 bg-slate-900 px-2 pr-6 text-[12px] text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
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

function SelectOrText({
  label,
  value,
  options,
  onChange,
  exact,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  exact?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <input
        list={`audit-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={exact ? 'exact match…' : 'substring…'}
        className="mt-0.5 h-8 w-full rounded-md border border-slate-800 bg-slate-900 px-2 text-[12px] text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
      />
      <datalist id={`audit-${label}`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}
