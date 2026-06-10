/**
 * Sidebar điều hướng cho route (app) — pattern Discord/Slack rail.
 *
 * Desktop (md+):
 *   - Mặc định w-14 rail chỉ hiện icons + tooltip on hover.
 *   - Hover vào sidebar → expand thành w-64 overlay (z-40, shadow phải)
 *     đè lên content. Chuột rời → collapse lại w-14.
 *   - Layout flex giữ chỗ w-14 cố định, expand không reflow content.
 *
 * Mobile (< md):
 *   - Hamburger fixed top-left → toggle drawer w-64 slide-in từ trái.
 *   - Overlay tối click để đóng. Nav route → tự đóng.
 *
 * Nav structure: 3 groups + Settings ở cuối:
 *   - Overview: Dashboard, Graph, Analytics, Study Plan
 *   - Learn   : Workspaces, AI Tutor
 *   - Social  : Rooms, Groups, Messages, Profile, Leaderboard
 *
 * Section labels (OVERVIEW, LEARN, SOCIAL) chỉ hiện khi expanded — rail mode
 * ẩn để gọn. Collapse state vẫn lưu localStorage cho khi expanded.
 *
 * Active state: dùng usePathname + `match` array (cho hub items có nhiều
 * sub-route, vd Workspaces match cả /documents /notes).
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  BrainCircuit,
  Calendar,
  ChevronDown,
  GraduationCap,
  LayoutDashboard,
  Library,
  MessageSquare,
  Network,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isAdminEmailClient } from '@/lib/admin/guard-client';
import { useSession } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/context';

import { useAppSidebar } from './app-sidebar-context';

// Nav structure — gọn lại theo "AI Learning OS":
// - Overview: tổng quan + analytics + planning
// - Learn: workspace tài liệu + AI tutor
// - Collaborate: groups (consolidate rooms + messages vào channels của group)
//   + profile + leaderboard
/**
 * V8.27: label + groupKey lưu i18n KEY thay vì literal string. Component
 * render dùng `t(key)` để chuyển sang text theo locale hiện tại.
 */
const navGroups = [
  {
    groupKey: 'sidebar.group.overview',
    items: [
      { href: '/dashboard', labelKey: 'sidebar.nav.dashboard', icon: LayoutDashboard },
      { href: '/graph', labelKey: 'sidebar.nav.graph', icon: Network },
      { href: '/study-plan', labelKey: 'sidebar.nav.study_plan', icon: GraduationCap },
    ],
  },
  {
    groupKey: 'sidebar.group.learn',
    items: [
      // Workspaces là entry duy nhất cho chat + recipes (atom-centric).
      {
        href: '/workspaces',
        labelKey: 'sidebar.nav.workspaces',
        icon: BookOpen,
        match: ['/workspaces', '/documents', '/notes', '/chat'],
      },
      {
        // V1 Library — kho tài liệu cộng đồng + AI search + import to workspace
        href: '/library',
        labelKey: 'sidebar.nav.library',
        icon: Library,
        match: ['/library'],
      },
    ],
  },
  {
    groupKey: 'sidebar.group.collaborate',
    items: [
      {
        href: '/groups',
        labelKey: 'sidebar.nav.groups',
        icon: Users,
        match: ['/groups', '/rooms'],
      },
      { href: '/messages', labelKey: 'sidebar.nav.messages', icon: MessageSquare },
      { href: '/leaderboard', labelKey: 'sidebar.nav.leaderboard', icon: Trophy },
    ],
  },
  {
    groupKey: 'sidebar.group.tutoring',
    items: [
      {
        href: '/tutoring',
        labelKey: 'sidebar.nav.tutoring',
        icon: Sparkles,
        match: ['/tutoring', '/tutors'],
        adminOnly: false,
      },
      {
        // V4 T4: lịch học (booking + class + blocked time unified view)
        href: '/tutoring/calendar',
        labelKey: 'sidebar.nav.calendar',
        icon: Calendar,
        match: ['/tutoring/calendar'],
        adminOnly: false,
      },
      {
        // V4 T3: wallet VND + ledger + topup
        href: '/wallet',
        labelKey: 'sidebar.nav.wallet',
        icon: Wallet,
        match: ['/wallet'],
        adminOnly: false,
      },
    ],
  },
] as const;

const COLLAPSE_STORAGE_KEY = 'cogniva.sidebar.collapsed';

/** Hook quản lý collapse state cho section (chỉ dùng khi expanded). */
function useCollapseState() {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        if (parsed && typeof parsed === 'object') setCollapsed(parsed);
      }
    } catch {
      /* localStorage không khả dụng */
    }
  }, []);

  const toggle = React.useCallback((label: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}

type SidebarBodyProps = {
  /** true = mode expanded (w-64), false = rail mode (w-14 icons-only). */
  expanded: boolean;
  /** Callback khi click item — dùng cho mobile drawer auto-close. */
  onItemClick?: () => void;
};

/** Nội dung nav dùng chung cho desktop rail/expanded + mobile drawer. */
function SidebarBody({ expanded, onItemClick }: SidebarBodyProps) {
  const pathname = usePathname();
  const { collapsed, toggle } = useCollapseState();
  const { data: session } = useSession();
  const t = useT();

  // Mounted guard chống hydration mismatch: useSession() trả null lúc SSR nhưng
  // có thể trả user (từ cache) ngay ở client render đầu → isAdmin lệch → số nav
  // item (mỗi item bọc radix Tooltip dùng useId) khác nhau → lệch useId của MỌI
  // radix sau đó (vd dropdown trong GroupShell) → cảnh báo hydrate. Giữ isAdmin
  // = false ở render đầu (khớp SSR), sau mount mới lộ item admin (update client).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const isAdmin = mounted && isAdminEmailClient(session?.user?.email ?? null);

  return (
    <>
      {/* Header — logo + brand. Premium treatment: gradient bg cho logo +
          subtle online dot (presence indicator) + letterspacing nhẹ. */}
      <Link
        href="/dashboard"
        onClick={onItemClick}
        aria-label={t('sidebar.back_to_dashboard')}
        title={!expanded ? 'Cogniva' : undefined}
        className={cn(
          'flex h-14 items-center gap-2.5 border-b border-sidebar-border transition-colors hover:bg-sidebar-accent/40',
          expanded ? 'px-4' : 'justify-center px-0',
        )}
      >
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-hover text-primary-foreground shadow-soft ring-1 ring-primary/30">
          <BrainCircuit className="h-[18px] w-[18px]" strokeWidth={2.25} />
          {/* Presence dot — online indicator, subtle pulse */}
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center"
          >
            <span className="absolute inset-0 rounded-full bg-success animate-soft-pulse opacity-60" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-success ring-2 ring-sidebar" />
          </span>
        </div>
        {expanded && (
          <div className="flex flex-col">
            <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight leading-tight">
              Cogniva
            </span>
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted leading-tight">
              Study OS
            </span>
          </div>
        )}
      </Link>

      {/* Nav scroll */}
      <ScrollArea className={cn('flex-1', expanded ? 'px-3 py-4' : 'px-2 py-3')}>
        <nav className={cn('flex flex-col', expanded ? 'gap-4' : 'gap-3')}>
          {navGroups.map((group, gIdx) => {
            // Filter adminOnly items khi user không phải admin
            const items = group.items.filter(
              (it) => !('adminOnly' in it && it.adminOnly && !isAdmin),
            );
            const visibleGroup = { ...group, items };
            if (items.length === 0) return null;
            const isItemActive = (it: (typeof visibleGroup.items)[number]) => {
              if (pathname === it.href || pathname.startsWith(`${it.href}/`)) return true;
              const matches = 'match' in it ? (it.match as readonly string[]) : null;
              return (
                matches?.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ??
                false
              );
            };
            const hasActive = items.some(isItemActive);
            const isCollapsed = !hasActive && Boolean(collapsed[group.groupKey]);
            const showItems = !expanded || !isCollapsed;

            return (
              <div key={group.groupKey} className="flex flex-col gap-1">
                {/* Section header — chỉ hiện khi expanded */}
                {expanded ? (
                  <button
                    type="button"
                    onClick={() => toggle(group.groupKey)}
                    className="flex items-center justify-between rounded px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
                    aria-expanded={!isCollapsed}
                  >
                    <span>{t(group.groupKey)}</span>
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 transition-transform',
                        isCollapsed && '-rotate-90',
                      )}
                    />
                  </button>
                ) : (
                  // Rail mode: divider mảnh giữa nhóm
                  gIdx > 0 && <div className="mx-2 my-0.5 h-px bg-sidebar-border" />
                )}

                {showItems && (
                  <div className="flex flex-col gap-0.5">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const isActive = isItemActive(item);
                      const itemLabel = t(item.labelKey);
                      const linkEl = (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={onItemClick}
                          aria-label={itemLabel}
                          className={cn(
                            'group/nav relative flex items-center rounded-md text-sm font-medium transition-all duration-150',
                            expanded ? 'gap-3 px-3 py-2' : 'h-9 w-9 justify-center self-center',
                            isActive
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground',
                          )}
                        >
                          {/* Accent bar trái — chỉ active mới hiện.
                              Expanded: vertical bar 2px dài 60% cao item.
                              Rail: dot accent bên trái icon. */}
                          {isActive && expanded && (
                            <span
                              aria-hidden
                              className="absolute -left-1.5 top-1/2 h-3/5 w-[2px] -translate-y-1/2 rounded-full bg-primary"
                            />
                          )}
                          {isActive && !expanded && (
                            <span
                              aria-hidden
                              className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-primary"
                            />
                          )}
                          <Icon
                            className={cn(
                              'h-4 w-4 shrink-0 transition-transform',
                              isActive && 'text-primary',
                              !isActive && 'group-hover/nav:scale-105',
                            )}
                            strokeWidth={isActive ? 2.25 : 1.75}
                          />
                          {expanded && (
                            <span className="whitespace-nowrap tracking-tight">
                              {itemLabel}
                            </span>
                          )}
                        </Link>
                      );
                      // Rail mode: wrap Radix Tooltip (delay 150ms, mượt hơn
                      // native `title` của browser ~500ms). Expanded mode đã có
                      // label inline → không cần tooltip.
                      if (!expanded) {
                        return (
                          <Tooltip key={item.href} delayDuration={150}>
                            <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8}>
                              {itemLabel}
                            </TooltipContent>
                          </Tooltip>
                        );
                      }
                      return linkEl;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </ScrollArea>

    </>
  );
}

/**
 * Sidebar component — desktop rail (hover expand) + mobile drawer.
 */
export function AppSidebar() {
  // Drawer open state lấy từ context — trigger button (MobileMenuTrigger) ở
  // trong AppTopbar share cùng state qua AppSidebarProvider.
  const { drawerOpen, setDrawerOpen } = useAppSidebar();
  const [desktopHovered, setDesktopHovered] = React.useState(false);
  /**
   * Debounce mouseleave 150ms — tránh flicker khi user vuốt chuột nhanh qua
   * biên sidebar (cursor tại x=14 đôi khi nằm trong/ngoài bbox đang animate
   * → mouseenter/leave fire liên tục). Delay nhỏ cho user 1 cửa sổ để quay
   * lại sidebar mà KHÔNG bị collapse.
   */
  const leaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDesktopEnter = React.useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setDesktopHovered(true);
  }, []);
  const handleDesktopLeave = React.useCallback(() => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      setDesktopHovered(false);
      leaveTimerRef.current = null;
    }, 150);
  }, []);
  // Cleanup pending timer khi unmount
  React.useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);
  const pathname = usePathname();

  // Đóng drawer mỗi khi route đổi (user bấm vào item → navigate)
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, setDrawerOpen]);

  return (
    <>
      {/* ── Mobile overlay drawer (slide-in từ trái) ── */}
      {drawerOpen && (
        <div
          role="presentation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground shadow-lg transition-transform md:hidden',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Đóng menu"
          className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
        {/* Mobile drawer always expanded layout */}
        <SidebarBody expanded onItemClick={() => setDrawerOpen(false)} />
      </aside>

      {/* ── Desktop rail (md+) ──
          Outer aside giữ chỗ w-14 trong flex layout. Inner div fixed-position
          với hover:w-64 overlay đè lên content khi expand. */}
      <aside className="hidden h-screen w-14 shrink-0 md:block" aria-hidden="true" />
      <div
        onMouseEnter={handleDesktopEnter}
        onMouseLeave={handleDesktopLeave}
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden h-screen flex-col border-r bg-sidebar text-sidebar-foreground transition-[width,box-shadow] duration-200 md:flex',
          desktopHovered ? 'w-64 shadow-xl' : 'w-14',
        )}
      >
        <SidebarBody expanded={desktopHovered} />
      </div>
    </>
  );
}
