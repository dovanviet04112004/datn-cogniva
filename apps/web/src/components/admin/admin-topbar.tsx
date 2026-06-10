/**
 * AdminTopbar — h-12 glass top bar cho admin console.
 *
 * Bao gồm:
 *   - Title page (breadcrumb-like: "Admin / [section]")
 *   - Search ⌘K placeholder (Phase 6 wire endpoint /api/admin/search)
 *   - Admin avatar + role pill + sign-out
 *
 * KHÔNG dùng ThemeToggle / PomodoroWidget / StreakBadge của app — admin
 * không có XP/streak.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

import { AdminCommandPalette } from '@/components/admin/admin-command-palette';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut as signOutV2 } from '@/lib/auth-api';
import { cn } from '@/lib/utils';
import type { AdminContext } from '@/lib/admin/guard';

export function AdminTopbar({ admin }: { admin: AdminContext }) {
  const router = useRouter();

  const signOut = async () => {
    await signOutV2();
    router.replace('/admin/sign-in');
  };

  const initial = (admin.name?.[0] ?? admin.email[0] ?? 'A').toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400 animate-soft-pulse" />
        Admin Console
      </div>

      {/* Global ⌘K search — Phase 6 */}
      <AdminCommandPalette />

      <div className="ml-auto flex items-center gap-3">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
            admin.role === 'SUPER_ADMIN'
              ? 'border-red-500/30 bg-red-500/10 text-red-400'
              : admin.role === 'ADMIN'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                : 'border-slate-600/30 bg-slate-700/10 text-slate-400',
          )}
        >
          {admin.role}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-slate-800"
              aria-label="Menu admin"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-red-500/20 text-[11px] font-semibold text-red-300">
                  {initial}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{admin.name ?? 'Admin'}</span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  {admin.email}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="gap-2.5 text-destructive focus:bg-destructive/10 focus:text-destructive">
              <LogOut className="h-4 w-4" />
              <span>Đăng xuất</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
