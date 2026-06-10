/**
 * TabNav — pill-style tab switcher cho /tutoring hub.
 *
 * Mỗi tab là <Link> push searchParam ?tab=... — server component sẽ re-render
 * theo searchParam, không cần client state. Active state tô primary, hover
 * subtle. Có icon trái + badge count optional.
 */
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

// V4 T4+T5: thêm 2 tab mới — classes (lớp nhóm) + favorites (tutor đã ♥)
// V5: thêm 'orders' (Đơn của tôi) — quản lý booking theo trạng thái.
export type TutoringTab =
  | 'tutors'
  | 'classes'
  | 'requests'
  | 'orders'
  | 'favorites'
  | 'mine';

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

  // Khi đổi tab, drop filter cũ — mỗi tab có scope filter riêng tránh
  // confuse user (filter "modality=ONLINE" hợp lệ cho cả tutors + requests
  // nhưng nhiều cái như "level" không cross-applicable).
  const buildHref = (tab: TutoringTab) => {
    // Giữ lại các filter primitive (subject/level/modality) khi switch
    // giữa các tab content tab; mine/favorites thì clear filter.
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
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-card/60 p-1.5 shadow-soft ring-1 ring-inset ring-divider">
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={buildHref(t.key)}
            className={cn(
              'group/tab relative inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-base',
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
