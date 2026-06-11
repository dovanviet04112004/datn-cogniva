'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AtSign,
  Calendar,
  Hash,
  Image as ImageIcon,
  Loader2,
  Search,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { parseSearch, stringifySearch, type SearchFilters } from '@/lib/group/search-query';

type Channel = { id: string; name: string };
type GroupMember = { userId: string; name: string | null };

type SearchResult = {
  id: string;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  content: string;
  snippet: string;
  createdAt: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupId: string;
};

const HAS_OPTIONS = [
  { value: 'image', label: 'Ảnh', icon: ImageIcon },
  { value: 'file', label: 'File', icon: ImageIcon },
] as const;

export function SearchDialog({ open, onOpenChange, groupId }: Props) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');

  const parsed = React.useMemo(() => parseSearch(query), [query]);

  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
    }
  }, [open]);

  const { data: channels = [] } = useQuery({
    queryKey: qk.groupChannels(groupId),
    queryFn: () =>
      apiGet<{ channels?: Channel[] }>(`/api/groups/${groupId}/channels`).then(
        (d) => d.channels ?? [],
      ),
    enabled: open,
  });
  const { data: members = [] } = useQuery({
    queryKey: qk.groupMembers(groupId),
    queryFn: () =>
      apiGet<{ members?: GroupMember[] }>(`/api/groups/${groupId}/members`).then(
        (d) => d.members ?? [],
      ),
    enabled: open,
  });

  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query, open]);

  const {
    data: searchData,
    isFetching,
    error: searchError,
  } = useQuery({
    queryKey: qk.groupSearch(groupId, debouncedQuery),
    queryFn: () =>
      apiGet<{
        results: SearchResult[];
        error?: string;
        sort?: 'rank' | 'recent';
      }>(`/api/groups/${groupId}/search?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: open && debouncedQuery.length > 0,
    placeholderData: keepPreviousData,
  });
  const results = debouncedQuery ? (searchData?.results ?? []) : [];
  const loading = isFetching && debouncedQuery.length > 0;
  const sort = searchData?.sort ?? 'rank';
  const error = searchError ? (searchError as Error).message : (searchData?.error ?? null);

  const setFilter = React.useCallback((key: keyof SearchFilters, value: string) => {
    setQuery((prev) => {
      const cur = parseSearch(prev);
      cur.filters[key] = value as never;
      return stringifySearch(cur);
    });
  }, []);

  const clearFilter = React.useCallback((key: keyof SearchFilters) => {
    setQuery((prev) => {
      const cur = parseSearch(prev);
      delete cur.filters[key];
      return stringifySearch(cur);
    });
  }, []);

  const openResult = (r: SearchResult) => {
    onOpenChange(false);
    router.push(`/groups/${groupId}/${r.channelId}#message-${r.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Search className="text-muted-foreground h-4 w-4" />
            Tìm tin nhắn trong nhóm
          </DialogTitle>
        </DialogHeader>

        <div className="border-b px-4 py-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Gõ từ khoá hoặc thêm filter (from:, in:, has:, before:, after:)…"
            autoFocus
            className="h-9 text-sm"
          />

          {Object.keys(parsed.filters).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {parsed.filters.in && (
                <FilterChip
                  icon={Hash}
                  label={
                    channels.find((c) => c.id === parsed.filters.in)?.name ?? parsed.filters.in
                  }
                  onRemove={() => clearFilter('in')}
                />
              )}
              {parsed.filters.from && (
                <FilterChip
                  icon={UserIcon}
                  label={`Từ: ${
                    members.find((m) => m.userId === parsed.filters.from)?.name ??
                    parsed.filters.from
                  }`}
                  onRemove={() => clearFilter('from')}
                />
              )}
              {parsed.filters.has && (
                <FilterChip
                  icon={ImageIcon}
                  label={`Có: ${parsed.filters.has}`}
                  onRemove={() => clearFilter('has')}
                />
              )}
              {parsed.filters.before && (
                <FilterChip
                  icon={Calendar}
                  label={`Trước: ${parsed.filters.before}`}
                  onRemove={() => clearFilter('before')}
                />
              )}
              {parsed.filters.after && (
                <FilterChip
                  icon={Calendar}
                  label={`Sau: ${parsed.filters.after}`}
                  onRemove={() => clearFilter('after')}
                />
              )}
              {parsed.filters.mentions && (
                <FilterChip
                  icon={AtSign}
                  label={`Mention: ${
                    members.find((m) => m.userId === parsed.filters.mentions)?.name ??
                    parsed.filters.mentions
                  }`}
                  onRemove={() => clearFilter('mentions')}
                />
              )}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-1">
            <ChipPicker
              label="Trong channel"
              icon={Hash}
              options={channels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
              onPick={(v) => setFilter('in', v)}
            />
            <ChipPicker
              label="Từ user"
              icon={UserIcon}
              options={members.map((m) => ({
                value: m.userId,
                label: m.name ?? '(no name)',
              }))}
              onPick={(v) => setFilter('from', v)}
            />
            <ChipPicker
              label="Có"
              icon={ImageIcon}
              options={HAS_OPTIONS.map((h) => ({ value: h.value, label: h.label }))}
              onPick={(v) => setFilter('has', v)}
            />
          </div>
        </div>

        <ScrollArea className="h-[420px]">
          {error && <p className="text-muted-foreground px-4 py-8 text-center text-xs">{error}</p>}
          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Đang tìm…
            </div>
          ) : results.length === 0 && !error ? (
            <EmptyState query={query} />
          ) : (
            <ul className="divide-y">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => openResult(r)}
                    className="hover:bg-accent/50 block w-full px-4 py-2.5 text-left transition-colors"
                  >
                    <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                      <span>
                        <span className="text-foreground font-medium">
                          {r.authorName ?? 'Anonymous'}
                        </span>
                        {' · #'}
                        {r.channelName}
                      </span>
                      <span>
                        {new Date(r.createdAt).toLocaleDateString('vi-VN', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[13px]">{r.snippet}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <div className="bg-muted/30 text-muted-foreground border-t px-4 py-2 text-[10.5px]">
          {results.length > 0 && (
            <span>
              {results.length} kết quả · {sort === 'rank' ? 'Sort: liên quan' : 'Sort: mới nhất'} ·
              ↵ để mở, Esc đóng
            </span>
          )}
          {results.length === 0 && (
            <span>Hỗ trợ syntax: from:userId, in:channelId, has:image, before:YYYY-MM-DD</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  icon: Icon,
  label,
  onRemove,
}: {
  icon: typeof Hash;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
      <Icon className="h-2.5 w-2.5" />
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Xoá filter"
        className="hover:bg-primary/20 rounded-full p-0.5"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

function ChipPicker({
  label,
  icon: Icon,
  options,
  onPick,
}: {
  label: string;
  icon: typeof Hash;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  const [search, setSearch] = React.useState('');

  const filtered = React.useMemo(() => {
    if (!search.trim()) return options.slice(0, 30);
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 30);
  }, [options, search]);

  return (
    <details ref={detailsRef} className="relative">
      <summary
        className={cn(
          'bg-card hover:bg-muted inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
          'list-none [&::-webkit-details-marker]:hidden',
        )}
      >
        <Icon className="h-2.5 w-2.5" />
        {label}
      </summary>
      <div className="bg-popover absolute left-0 top-full z-20 mt-1 w-56 rounded-md border p-1 shadow-md">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm…"
          className="h-7 text-xs"
          autoFocus
        />
        <div className="mt-1 max-h-48 overflow-auto">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-2 py-2 text-center text-[11px]">Không có</p>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onPick(opt.value);
                  setSearch('');
                  detailsRef.current?.removeAttribute('open');
                }}
                className="hover:bg-accent block w-full truncate rounded px-2 py-1 text-left text-[12px]"
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      </div>
    </details>
  );
}

function EmptyState({ query }: { query: string }) {
  if (!query.trim()) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12">
        <Search className="text-muted-foreground/40 h-10 w-10" />
        <p className="text-sm font-medium">Tìm trong toàn bộ nhóm</p>
        <p className="text-muted-foreground max-w-[300px] text-center text-[11px]">
          Gõ từ khoá, hoặc bấm chip bên trên để filter theo channel / user / loại file.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12">
      <p className="text-sm font-medium">Không tìm thấy</p>
      <p className="text-muted-foreground text-[11px]">Thử bỏ bớt filter hoặc đổi từ khoá.</p>
    </div>
  );
}
