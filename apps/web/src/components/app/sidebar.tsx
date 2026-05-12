/**
 * Sidebar điều hướng cho route (app).
 *
 * Hai chế độ:
 *   - Desktop (md+): cố định trái, w-64, luôn hiển thị.
 *   - Mobile (< md): ẩn mặc định; nút hamburger fixed top-left toggle
 *     drawer trượt từ trái + overlay tối. Click ngoài/sau khi navigate
 *     → tự đóng.
 *
 * Nhóm điều hướng (navGroups):
 *   - Overview : Dashboard, Knowledge Graph, Analytics
 *   - Learn    : Workspaces, Documents, AI Tutor
 *   - Practice : Flashcards, Quizzes, Study Plan
 *   + (cuối)   : Settings
 *
 * Active state: dùng usePathname để highlight item khi pathname trùng hoặc
 * bắt đầu bằng href + "/" (ví dụ /flashcards/123 vẫn highlight "Flashcards").
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  BrainCircuit,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LineChart,
  ClipboardList,
  ListChecks,
  Menu,
  MessageSquare,
  Network,
  NotebookPen,
  Settings,
  Trophy,
  User as UserIcon,
  Users,
  Video,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

// `as const` để TypeScript suy luận literal types cho href.
const navGroups = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/graph', label: 'Knowledge Graph', icon: Network },
      { href: '/analytics', label: 'Analytics', icon: LineChart },
    ],
  },
  {
    label: 'Learn',
    items: [
      { href: '/workspaces', label: 'Workspaces', icon: BookOpen },
      { href: '/documents', label: 'Documents', icon: FileText },
      { href: '/notes', label: 'Notes', icon: NotebookPen },
      { href: '/chat', label: 'AI Tutor', icon: MessageSquare },
    ],
  },
  {
    label: 'Practice',
    items: [
      { href: '/flashcards', label: 'Flashcards', icon: BrainCircuit },
      { href: '/quiz', label: 'Quizzes', icon: ListChecks },
      { href: '/exams', label: 'Exams', icon: ClipboardList },
      { href: '/study-plan', label: 'Study Plan', icon: GraduationCap },
    ],
  },
  {
    label: 'Spaces',
    items: [
      { href: '/rooms', label: 'Study Rooms', icon: Video },
    ],
  },
  {
    label: 'Social',
    items: [
      { href: '/profile', label: 'Profile', icon: UserIcon },
      { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
      { href: '/groups', label: 'Study Groups', icon: Users },
    ],
  },
] as const;

/** Nội dung nav dùng chung cho desktop + mobile drawer. */
function SidebarBody({ onItemClick }: { onItemClick?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {/* Header — logo + brand */}
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <BrainCircuit className="h-5 w-5" />
        </div>
        <span className="text-base font-semibold">Cogniva</span>
      </div>

      {/* Vùng nav cuộn */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-6">
          {navGroups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onItemClick}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Settings — cuối */}
      <Separator />
      <div className="p-3">
        <Link
          href="/settings"
          onClick={onItemClick}
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            pathname.startsWith('/settings')
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </>
  );
}

/**
 * Sidebar component — render cả desktop (luôn hiện ở md+) và mobile
 * (drawer overlay khi toggle bằng hamburger).
 */
export function AppSidebar() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Đóng drawer mỗi khi route đổi (user bấm vào item → navigate)
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* ── Mobile hamburger trigger (fixed, hiện < md) ── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Mở menu"
        className="fixed left-3 top-3 z-30 inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background/90 text-foreground shadow-sm backdrop-blur md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* ── Mobile overlay drawer (slide-in từ trái) ── */}
      {open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground shadow-lg transition-transform md:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Close button trong drawer (góc phải header) */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Đóng menu"
          className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
        <SidebarBody onItemClick={() => setOpen(false)} />
      </aside>

      {/* ── Desktop sidebar (md+) ── */}
      <aside className="hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <SidebarBody />
      </aside>
    </>
  );
}
