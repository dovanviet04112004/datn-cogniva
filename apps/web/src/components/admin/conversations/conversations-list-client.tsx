'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Loader2, MessageSquare, Search, X } from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';

type Row = {
  id: string;
  title: string | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  messageCount: number;
  lastMessageAt: string | null;
};

type Filter = {
  q: string;
  userEmail: string;
};

export function ConversationsListClient() {
  const [filter, setFilter] = React.useState<Filter>({ q: '', userEmail: '' });
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [debouncedEmail, setDebouncedEmail] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(filter.q.trim());
      setDebouncedEmail(filter.userEmail.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [filter.q, filter.userEmail]);

  const buildQuery = (cursorParam?: string) => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set('q', debouncedQ);
    if (debouncedEmail) p.set('userEmail', debouncedEmail);
    if (cursorParam) p.set('cursor', cursorParam);
    p.set('limit', '50');
    return p.toString();
  };

  type Page = {
    conversations: Row[];
    nextCursor: string | null;
    total: number | null;
  };
  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: qk.adminConversations(debouncedQ, debouncedEmail),
    queryFn: ({ pageParam }) =>
      apiGet<Page>(`/api/admin/conversations?${buildQuery(pageParam ?? undefined)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows = React.useMemo(() => data?.pages.flatMap((p) => p.conversations) ?? [], [data]);
  const total = data?.pages[0]?.total ?? null;
  const loadMore = () => {
    if (hasNextPage && !loadingMore) void fetchNextPage();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
          {total !== null && (
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {total.toLocaleString('vi-VN')} total
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400">
          Cuộc chat AI cross-user. Click row để xem full thread (read-only) hoặc xoá.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={filter.q}
            onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
            placeholder="Tiêu đề hội thoại…"
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
        <input
          value={filter.userEmail}
          onChange={(e) => setFilter((f) => ({ ...f, userEmail: e.target.value }))}
          placeholder="Email owner…"
          className="h-9 w-44 rounded-md border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2.5">Title</th>
              <th className="px-3 py-2.5">Owner</th>
              <th className="px-3 py-2.5">Workspace</th>
              <th className="px-3 py-2.5 text-center">Msgs</th>
              <th className="px-3 py-2.5">Tạo</th>
              <th className="px-3 py-2.5">Hoạt động</th>
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
                  Không có conversation khớp filter.
                </td>
              </tr>
            ) : (
              rows.map((c) => <ConvRow key={c.id} c={c} />)
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

function ConvRow({ c }: { c: Row }) {
  return (
    <tr className="border-b border-slate-800/60 transition-colors hover:bg-slate-800/40">
      <td className="px-3 py-2">
        <Link
          href={`/admin/conversations/${c.id}`}
          className="flex items-center gap-2 text-slate-100"
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="truncate text-[13px] font-medium">
            {c.title?.trim() || <span className="italic text-slate-500">— không có tiêu đề —</span>}
          </span>
        </Link>
      </td>
      <td className="px-3 py-2">
        {c.userId ? (
          <Link
            href={`/admin/users/${c.userId}`}
            className="flex flex-col leading-tight transition-colors hover:text-slate-100"
          >
            <span className="truncate text-[12px] text-slate-300">{c.userName ?? '—'}</span>
            <span className="truncate font-mono text-[10.5px] text-slate-500">
              {c.userEmail ?? '—'}
            </span>
          </Link>
        ) : (
          '—'
        )}
      </td>
      <td className="truncate px-3 py-2 text-[12px] text-slate-400">{c.workspaceName ?? '—'}</td>
      <td className="px-3 py-2 text-center font-mono text-[11px] tabular-nums text-slate-300">
        {c.messageCount}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-500">
        {new Date(c.createdAt).toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
        })}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-500">
        {c.lastMessageAt
          ? new Date(c.lastMessageAt).toLocaleDateString('vi-VN', {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit',
            })
          : '—'}
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={`/admin/conversations/${c.id}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          aria-label="Chi tiết"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </td>
    </tr>
  );
}
