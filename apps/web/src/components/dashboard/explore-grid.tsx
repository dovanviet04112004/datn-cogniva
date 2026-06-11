import Link from 'next/link';
import { ChevronRight, GraduationCap, Library, Share2, Users, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export type Capability = {
  icon: LucideIcon;
  label: string;
  desc: string;
  href: string;
};

export const EXPLORE_CAPABILITIES: Capability[] = [
  { icon: Library, label: 'Kho tài liệu', desc: 'Tài liệu cộng đồng', href: '/library' },
  { icon: Share2, label: 'Bản đồ kiến thức', desc: 'Knowledge graph', href: '/graph' },
  { icon: Users, label: 'Nhóm học', desc: 'Học nhóm realtime', href: '/groups' },
  { icon: GraduationCap, label: 'Gia sư', desc: 'Đặt lịch 1-1', href: '/tutoring' },
];

export function ExploreGrid({
  items,
  gridClassName = 'grid-cols-2 sm:grid-cols-4',
}: {
  items?: Capability[];
  gridClassName?: string;
}) {
  const caps = items ?? EXPLORE_CAPABILITIES;
  return (
    <div className={cn('grid gap-2', gridClassName)}>
      {caps.map((c) => {
        const CIcon = c.icon;
        return (
          <Link
            key={c.label}
            href={c.href}
            className="group/cap border-divider bg-surface hover:border-primary/40 hover:bg-muted/50 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors"
          >
            <div className="bg-discovery-500/10 text-discovery-600 group-hover/cap:bg-discovery-500/15 dark:text-discovery-400 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors">
              <CIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{c.label}</p>
              <p className="text-muted-foreground truncate text-[11px]">{c.desc}</p>
            </div>
            <ChevronRight className="text-muted-foreground/30 group-hover/cap:text-primary h-3.5 w-3.5 shrink-0 transition-all group-hover/cap:translate-x-0.5" />
          </Link>
        );
      })}
    </div>
  );
}
