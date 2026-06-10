/**
 * AdminSidebar — nav cố định 240px cho admin console.
 *
 * KHÔNG hover-expand như AppSidebar — admin cần label luôn rõ. 7 group theo
 * docs/plans/admin.md §4.2. Item adminOnly filter theo role (SUPER_ADMIN thấy hết,
 * ADMIN thiếu billing/refund, SUPPORT view-only).
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Ban,
  BookOpen,
  ChevronDown,
  CircuitBoard,
  ClipboardList,
  Coins,
  FileText,
  Flag,
  Gauge,
  GraduationCap,
  Hammer,
  History,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  Star,
  ToggleRight,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { AdminRole } from '@cogniva/db';

type NavItem = {
  href: string;
  label: string;
  icon: typeof Users;
  /** Roles được phép thấy item — undefined = mọi role. */
  roles?: AdminRole[];
  /** Match thêm pattern phụ cho active state. */
  match?: string[];
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/admin', label: 'Dashboard', icon: Gauge },
      { href: '/admin/audit', label: 'Audit log', icon: History },
      { href: '/admin/security', label: 'Bảo mật (2FA)', icon: ShieldCheck },
    ],
  },
  {
    label: 'Users & Access',
    items: [
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/moderation/banned', label: 'Banned', icon: Ban },
      { href: '/admin/moderation/reports', label: 'Reports', icon: Flag },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/documents', label: 'Documents', icon: FileText },
      { href: '/admin/conversations', label: 'Conversations', icon: MessageSquare },
      { href: '/admin/groups', label: 'Study groups', icon: BookOpen },
    ],
  },
  {
    label: 'Tutoring',
    items: [
      {
        href: '/admin/tutoring/kyc',
        label: 'KYC queue',
        icon: ShieldAlert,
        match: ['/admin/tutoring/kyc', '/admin/kyc'],
      },
      { href: '/admin/tutoring/bookings', label: 'Bookings', icon: GraduationCap },
      { href: '/admin/tutoring/reviews', label: 'Reviews', icon: Star },
    ],
  },
  {
    label: 'AI & Costs',
    items: [
      { href: '/admin/ai/cost', label: 'Cost dashboard', icon: Coins },
      { href: '/admin/ai/usage', label: 'Usage by user', icon: Activity },
      {
        href: '/admin/ai/circuits',
        label: 'Circuit breakers',
        icon: CircuitBoard,
        roles: ['SUPER_ADMIN', 'ADMIN'],
      },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/system/jobs', label: 'Background jobs', icon: ClipboardList },
      {
        href: '/admin/system/flags',
        label: 'Feature flags',
        icon: ToggleRight,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/admin/system/maintenance',
        label: 'Maintenance',
        icon: Hammer,
        roles: ['SUPER_ADMIN'],
      },
    ],
  },
];

export function AdminSidebar({ role }: { role: AdminRole }) {
  const pathname = usePathname();

  const isItemActive = (item: NavItem) => {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
    return item.match?.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ?? false;
  };

  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 md:flex">
      <Link
        href="/admin"
        className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-800 px-4 transition-colors hover:bg-slate-900/60"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-red-500/20 to-amber-500/10 ring-1 ring-inset ring-red-500/30">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" strokeWidth={2.25} />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Cogniva</span>
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-red-400/80">
            Admin
          </span>
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-4">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter(
            (it) => !it.roles || it.roles.includes(role),
          );
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="flex flex-col gap-1">
              <span className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {group.label}
              </span>
              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isItemActive(item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'group/it relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                        active
                          ? 'bg-slate-800 text-slate-50'
                          : 'text-slate-400 hover:bg-slate-900/70 hover:text-slate-100',
                      )}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute -left-1 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-red-400"
                        />
                      )}
                      <Icon
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          active ? 'text-red-400' : 'text-slate-500',
                        )}
                        strokeWidth={active ? 2.25 : 1.75}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 px-3 py-2">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-300"
          title="Quay về app user"
        >
          <ChevronDown className="h-3 w-3 rotate-90" />
          Quay về Cogniva app
        </Link>
      </div>
    </aside>
  );
}
