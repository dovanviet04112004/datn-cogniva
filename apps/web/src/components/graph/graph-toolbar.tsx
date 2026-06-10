/**
 * GraphToolbar — thanh toolbar trên Knowledge Graph canvas.
 *
 * 4 nhóm chính (trái → phải):
 *   1. Search box — gõ tên concept để filter (fuzzy substring match), `/` focus
 *   2. Domain filter chips — toggle 1 domain để chỉ hiện node cùng domain
 *   3. Stats — số concept / edge / domain
 *   4. Mine prereq button — POST /api/graph/mine, refresh khi xong
 *
 * Toolbar sticky top: luôn hiện kể cả khi pan/zoom canvas. Layout flex
 * wrap → mobile vẫn dùng được, mỗi nhóm xuống dòng nếu hẹp.
 */
'use client';

import * as React from 'react';
import { Search, Sparkles, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Friendly label cho domain — đồng bộ với graph-view.tsx. */
const DOMAIN_LABELS: Record<string, string> = {
  math: 'Toán',
  cs: 'Khoa học máy tính',
  physics: 'Vật lý',
  chemistry: 'Hóa học',
  biology: 'Sinh học',
  history: 'Lịch sử',
  language: 'Ngôn ngữ',
  business: 'Kinh doanh',
  general: 'Khác',
  unknown: 'Chưa phân loại',
};

/** Domain → dot color cho chip — đồng bộ với MiniMap palette. */
const DOMAIN_DOT_COLOR: Record<string, string> = {
  math: 'bg-blue-500',
  cs: 'bg-purple-500',
  physics: 'bg-orange-500',
  chemistry: 'bg-pink-500',
  biology: 'bg-green-500',
  history: 'bg-amber-500',
  language: 'bg-rose-500',
  business: 'bg-emerald-500',
};

type DomainCount = { domain: string; count: number };

type Props = {
  /** Domain → count, sort theo count giảm dần. */
  domainCounts: DomainCount[];
  /** Domain đang active (null = hiển thị tất cả). */
  activeDomain: string | null;
  onDomainChange: (domain: string | null) => void;
  /** Search query — controlled. */
  searchQuery: string;
  onSearchChange: (q: string) => void;
  /** Stats để hiện ngắn gọn ở giữa. */
  totalConcepts: number;
  totalEdges: number;
  /** Callback re-fetch graph sau khi mine xong. */
  onMined: () => void;
};

export function GraphToolbar({
  domainCounts,
  activeDomain,
  onDomainChange,
  searchQuery,
  onSearchChange,
  totalConcepts,
  totalEdges,
  onMined,
}: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [mining, setMining] = React.useState(false);

  // Keyboard: `/` focus search; `Escape` blur + clear
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape' && target === inputRef.current) {
        onSearchChange('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSearchChange]);

  const mine = async () => {
    setMining(true);
    try {
      const res = await fetch('/api/graph/mine', { method: 'POST' });
      const data = (await res.json().catch(() => null)) as
        | { inserted?: number; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Status ${res.status}`);
      }
      const n = data?.inserted ?? 0;
      toast.success(
        n > 0
          ? `Đã tìm thêm ${n} liên kết khái niệm.`
          : 'Không tìm thấy liên kết mới — graph đã cập nhật.',
      );
      onMined();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setMining(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-divider bg-surface/40 px-3 py-2 backdrop-blur-sm sm:px-4">
      {/* ── Search ─────────────────────────────────── */}
      <div className="relative min-w-[200px] flex-1 sm:flex-initial sm:min-w-[260px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Tìm khái niệm... (/)"
          className="h-8 w-full rounded-md border border-divider bg-background pl-8 pr-7 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Xóa tìm kiếm"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* ── Domain filter chips ───────────────────── */}
      <div className="flex max-w-full items-center gap-1 overflow-x-auto">
        <Chip
          active={activeDomain === null}
          onClick={() => onDomainChange(null)}
          dotClass="bg-muted-foreground/60"
        >
          Tất cả · {totalConcepts}
        </Chip>
        {domainCounts.map((d) => (
          <Chip
            key={d.domain}
            active={activeDomain === d.domain}
            onClick={() =>
              onDomainChange(activeDomain === d.domain ? null : d.domain)
            }
            dotClass={DOMAIN_DOT_COLOR[d.domain] ?? 'bg-slate-500'}
          >
            {DOMAIN_LABELS[d.domain] ?? d.domain} · {d.count}
          </Chip>
        ))}
      </div>

      {/* ── Spacer + Stats + Mine button ─────────── */}
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground md:inline">
          {totalEdges} liên kết
        </span>
        <Button
          onClick={mine}
          disabled={mining || totalConcepts < 2}
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          title={
            totalConcepts < 2
              ? 'Cần ≥ 2 khái niệm để mine'
              : 'AI tìm thêm liên kết prerequisite giữa các khái niệm'
          }
        >
          {mining ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">Đang phân tích...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              <span className="text-xs">Tìm liên kết</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  dotClass,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  dotClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-primary/40 bg-primary/10 text-foreground'
          : 'border-divider bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
      {children}
    </button>
  );
}
