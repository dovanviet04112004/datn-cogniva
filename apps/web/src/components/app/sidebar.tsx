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
import { useMe } from '@/lib/use-me';
import { useT } from '@/lib/i18n/context';

import { useAppSidebar } from './app-sidebar-context';

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
      {
        href: '/workspaces',
        labelKey: 'sidebar.nav.workspaces',
        icon: BookOpen,
        match: ['/workspaces', '/documents', '/notes', '/chat'],
      },
      {
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
        href: '/tutoring/calendar',
        labelKey: 'sidebar.nav.calendar',
        icon: Calendar,
        match: ['/tutoring/calendar'],
        adminOnly: false,
      },
      {
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

function useCollapseState() {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        if (parsed && typeof parsed === 'object') setCollapsed(parsed);
      }
    } catch {}
  }, []);

  const toggle = React.useCallback((label: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  return { collapsed, toggle };
}

type SidebarBodyProps = {
  expanded: boolean;
  onItemClick?: () => void;
};

function SidebarBody({ expanded, onItemClick }: SidebarBodyProps) {
  const pathname = usePathname();
  const { collapsed, toggle } = useCollapseState();
  const { data: me } = useMe();
  const t = useT();

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const isAdmin = mounted && isAdminEmailClient(me?.email ?? null);

  return (
    <>
      <Link
        href="/dashboard"
        onClick={onItemClick}
        aria-label={t('sidebar.back_to_dashboard')}
        title={!expanded ? 'Cogniva' : undefined}
        className={cn(
          'border-sidebar-border hover:bg-sidebar-accent/40 flex h-14 items-center gap-2.5 border-b transition-colors',
          expanded ? 'px-4' : 'justify-center px-0',
        )}
      >
        <div className="from-primary to-primary-hover text-primary-foreground shadow-soft ring-primary/30 relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1">
          <BrainCircuit className="h-[18px] w-[18px]" strokeWidth={2.25} />
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center"
          >
            <span className="bg-success animate-soft-pulse absolute inset-0 rounded-full opacity-60" />
            <span className="bg-success ring-sidebar relative h-1.5 w-1.5 rounded-full ring-2" />
          </span>
        </div>
        {expanded && (
          <div className="flex flex-col">
            <span className="whitespace-nowrap text-[15px] font-semibold leading-tight tracking-tight">
              Cogniva
            </span>
            <span className="text-text-muted text-[11px] font-medium uppercase leading-tight tracking-[0.14em]">
              Study OS
            </span>
          </div>
        )}
      </Link>

      <ScrollArea className={cn('flex-1', expanded ? 'px-3 py-4' : 'px-2 py-3')}>
        <nav className={cn('flex flex-col', expanded ? 'gap-4' : 'gap-3')}>
          {navGroups.map((group, gIdx) => {
            const items = group.items.filter(
              (it) => !('adminOnly' in it && it.adminOnly && !isAdmin),
            );
            const visibleGroup = { ...group, items };
            if (items.length === 0) return null;
            const isItemActive = (it: (typeof visibleGroup.items)[number]) => {
              if (pathname === it.href || pathname.startsWith(`${it.href}/`)) return true;
              const matches = 'match' in it ? (it.match as readonly string[]) : null;
              return matches?.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ?? false;
            };
            const hasActive = items.some(isItemActive);
            const isCollapsed = !hasActive && Boolean(collapsed[group.groupKey]);
            const showItems = !expanded || !isCollapsed;

            return (
              <div key={group.groupKey} className="flex flex-col gap-1">
                {expanded ? (
                  <button
                    type="button"
                    onClick={() => toggle(group.groupKey)}
                    className="text-muted-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground flex items-center justify-between rounded px-3 py-1 text-xs font-medium uppercase tracking-wider transition-colors"
                    aria-expanded={!isCollapsed}
                  >
                    <span>{t(group.groupKey)}</span>
                    <ChevronDown
                      className={cn('h-3 w-3 transition-transform', isCollapsed && '-rotate-90')}
                    />
                  </button>
                ) : (
                  gIdx > 0 && <div className="bg-sidebar-border mx-2 my-0.5 h-px" />
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
                          {isActive && expanded && (
                            <span
                              aria-hidden
                              className="bg-primary absolute -left-1.5 top-1/2 h-3/5 w-[2px] -translate-y-1/2 rounded-full"
                            />
                          )}
                          {isActive && !expanded && (
                            <span
                              aria-hidden
                              className="bg-primary absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full"
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
                            <span className="whitespace-nowrap tracking-tight">{itemLabel}</span>
                          )}
                        </Link>
                      );
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

export function AppSidebar() {
  const { drawerOpen, setDrawerOpen } = useAppSidebar();
  const [desktopHovered, setDesktopHovered] = React.useState(false);
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
  React.useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);
  const pathname = usePathname();

  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, setDrawerOpen]);

  return (
    <>
      {drawerOpen && (
        <div
          role="presentation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}
      <aside
        className={cn(
          'bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col border-r shadow-lg transition-transform md:hidden',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Đóng menu"
          className="text-muted-foreground hover:bg-muted absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md"
        >
          <X className="h-4 w-4" />
        </button>
        <SidebarBody expanded onItemClick={() => setDrawerOpen(false)} />
      </aside>

      <aside className="hidden h-screen w-14 shrink-0 md:block" aria-hidden="true" />
      <div
        onMouseEnter={handleDesktopEnter}
        onMouseLeave={handleDesktopLeave}
        className={cn(
          'bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-40 hidden h-screen flex-col border-r transition-[width,box-shadow] duration-200 md:flex',
          desktopHovered ? 'w-64 shadow-xl' : 'w-14',
        )}
      >
        <SidebarBody expanded={desktopHovered} />
      </div>
    </>
  );
}
