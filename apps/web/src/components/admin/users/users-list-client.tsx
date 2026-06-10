/**
 * UsersListClient — list users với search, filter chip, cursor pagination.
 *
 * UX:
 *   - Search debounce 300ms (substring name/email)
 *   - Filter chip toggle: all / FREE / PRO / TEAM / active / suspended / admin
 *   - Table dày 36px row, hover bg-slate-800/40
 *   - Click row → navigate /admin/users/[id]
 *   - Footer: "Tải thêm" button khi có nextCursor
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  Crown,
  Loader2,
  Search,
  ShieldCheck,
  UserX,
  X,
} from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  plan: 'FREE' | 'PRO' | 'TEAM';
  isPublic: boolean;
  adminRole: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | null;
  suspendedAt: string | null;
  createdAt: string;
};

type Filter = {
  q: string;
  plan: '' | 'FREE' | 'PRO' | 'TEAM';
  status: '' | 'active' | 'suspended';
  adminOnly: boolean;
};

export function UsersListClient() {
  const [filter, setFilter] = React.useState<Filter>({
    q: '',
    plan: '',
    status: '',
    adminOnly: false,
  });
  const [debouncedQ, setDebouncedQ] = React.useState('');

  // Debounce search 300ms
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filter.q.trim()), 300);
    return () => clearTimeout(t);
  }, [filter.q]);

  const buildQuery = (cursorParam?: string) => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set('q', debouncedQ);
    if (filter.plan) p.set('plan', filter.plan);
    if (filter.status) p.set('status', filter.status);
    if (filter.adminOnly) p.set('adminOnly', '1');
    if (cursorParam) p.set('cursor', cursorParam);
    p.set('limit', '50');
    return p.toString();
  };

  // Cursor pagination qua useInfiniteQuery — key gồm filter + debouncedQ nên
  // đổi filter tự refetch lại từ trang 1 (không cần effect reset thủ công).
  type Page = { users: UserRow[]; nextCursor: string | null; total: number | null };
  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: qk.adminUsers(debouncedQ, filter.plan, filter.status, filter.adminOnly),
    queryFn: ({ pageParam }) =>
      apiGet<Page>(`/api/admin/users?${buildQuery(pageParam ?? undefined)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows = React.useMemo(
    () => data?.pages.flatMap((p) => p.users) ?? [],
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
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          {total !== null && (
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {total.toLocaleString('vi-VN')} total
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400">
          Tìm, filter + bulk action trên user. Click row để xem chi tiết, suspend, change plan…
        </p>
      </header>

      {/* Search bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          value={filter.q}
          onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
          placeholder="Tìm theo name hoặc email…"
          className="h-9 w-full max-w-md rounded-md border border-slate-800 bg-slate-900 pl-8 pr-7 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
        />
        {filter.q && (
          <button
            onClick={() => setFilter((f) => ({ ...f, q: '' }))}
            className="absolute left-[calc(min(100%,28rem)-1.75rem)] top-1/2 -translate-y-1/2 rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip
          active={filter.plan === ''}
          onClick={() => setFilter((f) => ({ ...f, plan: '' }))}
        >
          Tất cả plan
        </FilterChip>
        {(['FREE', 'PRO', 'TEAM'] as const).map((p) => (
          <FilterChip
            key={p}
            active={filter.plan === p}
            onClick={() => setFilter((f) => ({ ...f, plan: p }))}
          >
            {p}
          </FilterChip>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-800" />
        <FilterChip
          active={filter.status === ''}
          onClick={() => setFilter((f) => ({ ...f, status: '' }))}
        >
          Mọi trạng thái
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
        <span className="mx-1 h-4 w-px bg-slate-800" />
        <FilterChip
          active={filter.adminOnly}
          onClick={() => setFilter((f) => ({ ...f, adminOnly: !f.adminOnly }))}
        >
          <ShieldCheck className="h-3 w-3" />
          Admin only
        </FilterChip>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2.5">User</th>
              <th className="px-3 py-2.5">Plan</th>
              <th className="px-3 py-2.5">Role</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Đăng ký</th>
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
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="py-12 text-center text-xs text-slate-500"
                >
                  Không có user khớp filter.
                </td>
              </tr>
            ) : (
              rows.map((u) => <UserRowItem key={u.id} u={u} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {hasNextPage && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {loadingMore ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Tải thêm
          </button>
        </div>
      )}
    </div>
  );
}

function UserRowItem({ u }: { u: UserRow }) {
  const initial = (u.name?.[0] ?? u.email[0] ?? '?').toUpperCase();
  return (
    <tr className="group/row border-b border-slate-800/60 transition-colors hover:bg-slate-800/40">
      <td className="px-3 py-2">
        <Link
          href={`/admin/users/${u.id}`}
          className="flex items-center gap-2.5 text-slate-100"
        >
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarImage src={u.image ?? undefined} />
            <AvatarFallback className="bg-slate-800 text-[10.5px] text-slate-300">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight">
              {u.name ?? '—'}
            </p>
            <p className="truncate font-mono text-[10.5px] text-slate-500">
              {u.email}
            </p>
          </div>
        </Link>
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
            u.plan === 'TEAM'
              ? 'border-purple-500/30 bg-purple-500/10 text-purple-300'
              : u.plan === 'PRO'
                ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                : 'border-slate-600/30 bg-slate-700/20 text-slate-400',
          )}
        >
          {u.plan !== 'FREE' && <Crown className="h-2.5 w-2.5" />}
          {u.plan}
        </span>
      </td>
      <td className="px-3 py-2">
        {u.adminRole ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
              u.adminRole === 'SUPER_ADMIN'
                ? 'border-red-500/30 bg-red-500/10 text-red-400'
                : u.adminRole === 'ADMIN'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                  : 'border-slate-600/30 bg-slate-700/10 text-slate-400',
            )}
          >
            <ShieldCheck className="h-2.5 w-2.5" />
            {u.adminRole}
          </span>
        ) : (
          <span className="text-[10.5px] text-slate-600">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        {u.suspendedAt ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-red-400 ring-1 ring-inset ring-red-500/30">
            <UserX className="h-2.5 w-2.5" />
            SUSPENDED
          </span>
        ) : (
          <span className="font-mono text-[10.5px] text-emerald-400">active</span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-500">
        {new Date(u.createdAt).toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
        })}
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={`/admin/users/${u.id}`}
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
