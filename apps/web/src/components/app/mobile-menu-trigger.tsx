/**
 * MobileMenuTrigger — hamburger button render INSIDE AppTopbar trên mobile.
 *
 * Pattern production: hamburger là flex child của topbar, KHÔNG fixed
 * floating. Click → open AppSidebar drawer qua context.
 *
 * Hidden md+ vì desktop có sidebar luôn visible (không cần hamburger).
 */
'use client';

import * as React from 'react';
import { Menu } from 'lucide-react';

import { useAppSidebar } from './app-sidebar-context';

export function MobileMenuTrigger() {
  const { setDrawerOpen } = useAppSidebar();
  return (
    <button
      type="button"
      onClick={() => setDrawerOpen(true)}
      aria-label="Mở menu"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent md:hidden"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
