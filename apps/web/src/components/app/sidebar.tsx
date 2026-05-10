/**
 * Sidebar điều hướng cho route (app) — cố định trái, ẩn trên mobile (md:flex).
 *
 * Nhóm điều hướng (navGroups):
 *   - Overview : Dashboard, Knowledge Graph, Analytics
 *   - Learn    : Workspaces, Documents, AI Tutor
 *   - Practice : Flashcards, Quizzes, Study Plan
 *   + (cuối)   : Settings (luôn ở đáy, tách bằng Separator)
 *
 * Active state: dùng usePathname để highlight item khi pathname trùng hoặc
 * bắt đầu bằng href + "/" (ví dụ /flashcards/123 vẫn highlight "Flashcards").
 *
 * Lưu ý: một số route trong list chưa tồn tại ở Phase 0 — middleware sẽ
 * redirect về /sign-in nếu user chưa đăng nhập, còn nếu đã đăng nhập sẽ
 * gặp 404 vì page chưa build. Sẽ giải quyết tự nhiên qua các phase.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  BrainCircuit,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LineChart,
  ListChecks,
  MessageSquare,
  Network,
  Settings,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

// `as const` để TypeScript suy luận literal types cho href — sau này
// có thể dùng làm union type cho route guard.
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
      { href: '/chat', label: 'AI Tutor', icon: MessageSquare },
    ],
  },
  {
    label: 'Practice',
    items: [
      { href: '/flashcards', label: 'Flashcards', icon: BrainCircuit },
      { href: '/quiz', label: 'Quizzes', icon: ListChecks },
      { href: '/study-plan', label: 'Study Plan', icon: GraduationCap },
    ],
  },
] as const;

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      {/* Header sidebar — logo + brand */}
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <BrainCircuit className="h-5 w-5" />
        </div>
        <span className="text-base font-semibold">Cogniva</span>
      </div>

      {/* Vùng nav cuộn — ScrollArea xử lý overflow gọn gàng */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-6">
          {navGroups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                // Active khi đúng pathname HOẶC pathname là sub-route
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
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

      {/* Separator + Settings — luôn ở cuối sidebar */}
      <Separator />
      <div className="p-3">
        <Link
          href="/settings"
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
    </aside>
  );
}
