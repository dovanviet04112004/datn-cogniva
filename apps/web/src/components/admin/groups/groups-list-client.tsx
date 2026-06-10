/**
 * GroupsListClient — list study groups cross-user với filter status.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Ban,
  BookOpen,
  ChevronRight,
  Globe2,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

type Row = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  isPublic: boolean;
  maxMembers: number;
  suspendedAt: string | null;
  suspendReason: string | null;
  createdAt: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  memberCount: number;
};

type Filter = {
  q: string;
  status: '' | 'active' | 'suspended' | 'public';
};

export function GroupsListClient() {
  const [filter, setFilter] = React.useState<Filter>({ q: '', status: '' });
  const [debouncedQ, setDebouncedQ] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filter.q.trim()), 300);
    return () => clearTimeout(t);
  }, [filter.q]);

  const buildQuery = (cursorParam?: string) => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set('q', debouncedQ);
    if (filter.status) p.set('status', filter.status);
    if (cursorParam) p.set('cursor', cursorParam);
    p.set('limit', '50');
    return p.toString();
  };

  type Page = { groups: Row[]; nextCursor: string | null; total: number | null };
  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: qk.adminGroups(debouncedQ, filter.status),
    queryFn: ({ pageParam }) =>
      apiGet<Page>(`/api/admin/groups?${buildQuery(pageParam ?? undefined)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows = React.useMemo(
    () => data?.pages.flatMap((p) => p.groups) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? null;
  const loadMore = () => {
    if (hasNextPage && !loadingMore) void fetchNextPage();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Study groups</h1>
          {total !== null && (
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {total.toLocaleString('vi-VN')} total
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400">
          Học nhóm cross-user. Click row để xem members + suspend group spam.
        </p>
      </header>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          value={filter.q}
          onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
          placeholder="Tên group…"
          className="h-9 w-full rounded-md border border-slate-800 bg-slate-900 pl-8 pr-7 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
        />
        {filter.q && (
          <button
            onClick={() => setFilter((f) => ({ ...f, q: '' }))}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip
          active={filter.status === ''}
          onClick={() => setFilter((f) => ({ ...f, status: '' }))}
        >
          Tất cả
        </FilterChip>
        <FilterChip
          active={filter.status === 'active'}
          onClick={() => setFilter((f) => ({ ...f, status: 'active' }))}
        >
          Active
        </FilterChip>
        <FilterChip
          active={filter.status === 'suspended'}
          onClick={() => setFilter((f) => ({ ...f, status: 'suspended' }))}
        >
          Suspended
        </FilterChip>
        <FilterChip
          active={filter.status === 'public'}
          onClick={() => setFilter((f) => ({ ...f, status: 'public' }))}
        >
          <Globe2 className="h-3 w-3" />
          Public
        </FilterChip>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2.5">Group</th>
              <th className="px-3 py-2.5">Owner</th>
              <th className="px-3 py-2.5 text-center">Members</th>
              <th className="px-3 py-2.5">Public</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Tạo</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-xs text-slate-500">
                  Không có group khớp filter.
                </td>
              </tr>
            ) : (
              rows.map((g) => <GroupRow key={g.id} g={g} />)
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

function GroupRow({ g }: { g: Row }) {
  const initial = (g.name?.[0] ?? '?').toUpperCase();
  return (
    <tr className="border-b border-slate-800/60 transition-colors hover:bg-slate-800/40">
      <td className="px-3 py-2">
        <Link href={`/admin/groups/${g.id}`} className="flex items-center gap-2 text-slate-100">
          <Avatar className="h-7 w-7 shrink-0 rounded-md">
            <AvatarImage src={g.iconUrl ?? undefined} className="rounded-md" />
            <AvatarFallback className="rounded-md bg-slate-800 text-[10.5px] text-slate-300">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight">{g.name}</p>
            <p className="truncate text-[10.5px] text-slate-500">
              {g.description ?? '—'}
            </p>
          </div>
        </Link>
      </td>
      <td className="px-3 py-2">
        {g.ownerId ? (
          <Link
            href={`/admin/users/${g.ownerId}`}
            className="flex flex-col leading-tight transition-colors hover:text-slate-100"
          >
            <span className="truncate text-[12px] text-slate-300">{g.ownerName ?? '—'}</span>
            <span className="truncate font-mono text-[10.5px] text-slate-500">
              {g.ownerEmail ?? '—'}
            </span>
          </Link>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2 text-center font-mono text-[11px] tabular-nums text-slate-300">
        {g.memberCount}/{g.maxMembers}
      </td>
      <td className="px-3 py-2">
        {g.isPublic ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-300">
            <Globe2 className="h-2.5 w-2.5" />
            public
          </span>
        ) : (
          <span className="text-[10.5px] text-slate-600">private</span>
        )}
      </td>
      <td className="px-3 py-2">
        {g.suspendedAt ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-red-400 ring-1 ring-inset ring-red-500/30"
            title={g.suspendReason ?? ''}
          >
            <Ban className="h-2.5 w-2.5" />
            SUSPENDED
          </span>
        ) : (
          <span className="font-mono text-[10.5px] text-emerald-400">active</span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-500">
        {new Date(g.createdAt).toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
        })}
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={`/admin/groups/${g.id}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          aria-label="Chi tiết"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </td>
    </tr>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-red-500/40 bg-red-500/10 text-red-300'
          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200',
      )}
    >
      {children}
    </button>
  );
}
