/**
 * AdminCommandPalette — ⌘K global search cho admin console.
 *
 * Pattern Notion/Linear: dropdown ngay dưới input. Click input hoặc Cmd+K mở,
 * gõ debounce 200ms → fetch /api/admin/search, Enter/click navigate.
 *
 * Phím tắt: ⌘K / Ctrl+K toggle. Esc đóng. ↑↓ navigate, Enter chọn.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  BookOpen,
  FileText,
  GraduationCap,
  Loader2,
  MessageSquare,
  Search,
  Users as UsersIcon,
} from 'lucide-react';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { AdminSearchHit } from '@/app/api/admin/search/route';
import { cn } from '@/lib/utils';

const TYPE_ICON: Record<AdminSearchHit['type'], typeof FileText> = {
  user: UsersIcon,
  document: FileText,
  conversation: MessageSquare,
  group: BookOpen,
  booking: GraduationCap,
};

const TYPE_LABEL: Record<AdminSearchHit['type'], string> = {
  user: 'Users',
  document: 'Documents',
  conversation: 'Conversations',
  group: 'Groups',
  booking: 'Bookings',
};

export function AdminCommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [isMac, setIsMac] = React.useState(false);

  const inputRef = React.useRef<HTMLInputElement>(null);

  // Detect Mac sau mount để swap Ctrl↔⌘ (hydration-safe)
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform));
  }, []);

  // Cmd+K / Ctrl+K toggle
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounce + fetch
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  // Search-as-you-type qua React Query — chỉ chạy khi ≥2 ký tự, cache theo query
  // nên gõ lại từ khoá cũ trả ngay từ cache. isFetching → spinner mỗi lần gõ.
  const { data: hits = [], isFetching: loading } = useQuery({
    queryKey: qk.adminSearch(debouncedQ),
    queryFn: () =>
      apiGet<{ hits: AdminSearchHit[] }>(
        `/api/admin/search?q=${encodeURIComponent(debouncedQ)}`,
      ).then((d) => d.hits),
    enabled: debouncedQ.length >= 2,
  });

  const select = (hit: AdminSearchHit) => {
    setOpen(false);
    setQ(''); // debouncedQ về '' → query tự disable, không cần clear hits thủ công
    router.push(hit.href);
  };

  // Group by type
  const groups = React.useMemo(() => {
    const map = new Map<AdminSearchHit['type'], AdminSearchHit[]>();
    for (const h of hits) {
      const arr = map.get(h.type) ?? [];
      arr.push(h);
      map.set(h.type, arr);
    }
    return map;
  }, [hits]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor className="ml-4 hidden flex-1 items-center md:flex">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className="flex h-7 w-full max-w-md items-center gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 text-xs text-slate-500 transition-colors hover:border-slate-700 hover:bg-slate-900"
        >
          <Search className="h-3 w-3" />
          <span>Tìm user, doc, conversation…</span>
          <span className="ml-auto font-mono text-[10px] text-slate-600">
            {isMac ? '⌘K' : 'Ctrl+K'}
          </span>
        </button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[min(560px,calc(100vw-2rem))] border-slate-800 bg-slate-950 p-0 text-slate-100"
      >
        <Command
          shouldFilter={false}
          className="overflow-hidden"
          loop
        >
          <div className="flex items-center gap-2 border-b border-slate-800 px-3">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <Command.Input
              ref={inputRef}
              value={q}
              onValueChange={setQ}
              placeholder="Tìm user / doc / conversation / group / booking…"
              className="h-10 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
            />
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
          </div>
          <Command.List className="max-h-[400px] overflow-y-auto p-1">
            {debouncedQ.length < 2 ? (
              <p className="px-3 py-6 text-center text-[11.5px] text-slate-500">
                Gõ ≥ 2 ký tự để tìm…
              </p>
            ) : hits.length === 0 && !loading ? (
              <Command.Empty className="px-3 py-6 text-center text-[11.5px] text-slate-500">
                Không tìm thấy kết quả.
              </Command.Empty>
            ) : (
              Array.from(groups.entries()).map(([type, items]) => {
                const Icon = TYPE_ICON[type];
                return (
                  <Command.Group
                    key={type}
                    heading={
                      <span className="px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {TYPE_LABEL[type]}
                      </span>
                    }
                  >
                    {items.map((h) => (
                      <Command.Item
                        key={h.href}
                        value={h.id}
                        onSelect={() => select(h)}
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-md px-2 py-2',
                          'data-[selected=true]:bg-slate-800',
                        )}
                      >
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-medium text-slate-100">
                            {h.title}
                          </p>
                          {h.subtitle && (
                            <p className="truncate font-mono text-[10px] text-slate-500">
                              {h.subtitle}
                            </p>
                          )}
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
