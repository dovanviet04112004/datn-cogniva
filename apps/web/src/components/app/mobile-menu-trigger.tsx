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
      className="text-foreground hover:bg-accent inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors md:hidden"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
