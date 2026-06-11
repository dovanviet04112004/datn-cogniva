'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  CalendarCheck,
  Heart,
  Search,
  Sparkles,
  User as UserIcon,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type TutoringTab = 'tutors' | 'classes' | 'requests' | 'orders' | 'favorites' | 'mine';

const TABS: Array<{ key: TutoringTab; label: string; icon: LucideIcon }> = [
  { key: 'tutors', label: 'Tìm gia sư', icon: Search },
  { key: 'classes', label: 'Lớp nhóm', icon: Users },
  { key: 'requests', label: 'Yêu cầu học', icon: Sparkles },
  { key: 'orders', label: 'Đơn học', icon: CalendarCheck },
  { key: 'favorites', label: 'Yêu thích', icon: Heart },
  { key: 'mine', label: 'Tổng quan', icon: UserIcon },
];

export function TutoringTabNav({ active }: { active: TutoringTab }) {
  const pathname = usePathname();
  const sp = useSearchParams();

  const buildHref = (tab: TutoringTab) => {
    if (tab === 'mine' || tab === 'favorites' || tab === 'orders') {
      return `${pathname}?tab=${tab}`;
    }
    const params = new URLSearchParams();
    params.set('tab', tab);
    for (const key of ['subject', 'level', 'modality'] as const) {
      const v = sp.get(key);
      if (v) params.set(key, v);
    }
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="bg-card/60 shadow-soft ring-divider flex flex-wrap items-center gap-1.5 rounded-2xl p-1.5 ring-1 ring-inset">
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={buildHref(t.key)}
            className={cn(
              'group/tab duration-base relative inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all',
              isActive
                ? 'bg-primary text-primary-foreground shadow-soft'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <Icon
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                !isActive && 'group-hover/tab:scale-105',
              )}
              strokeWidth={isActive ? 2.25 : 1.75}
            />
            <span className="tracking-tight">{t.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
