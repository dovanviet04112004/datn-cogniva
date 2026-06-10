/**
 * AppSidebarContext — chia sẻ state drawer open của AppSidebar (mobile) giữa:
 *   - AppSidebar (chứa drawer overlay)
 *   - MobileMenuTrigger (button hamburger render trong AppTopbar)
 *
 * Pattern production-grade (ChatGPT/Linear/Vercel): hamburger nằm INSIDE
 * topbar như flex child, không phải fixed-position floating button riêng.
 * Context cho phép components ở các vị trí khác nhau cùng share state.
 *
 * Wrap ở (app)/layout.tsx để cả AppSidebar + AppTopbar (children) đều access.
 */
'use client';

import * as React from 'react';

type Ctx = {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
};

const AppSidebarContext = React.createContext<Ctx | null>(null);

export function AppSidebarProvider({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  return (
    <AppSidebarContext.Provider value={{ drawerOpen, setDrawerOpen }}>
      {children}
    </AppSidebarContext.Provider>
  );
}

/**
 * Hook truy cập context. Throws nếu dùng ngoài Provider — bug detection.
 * Có thể safe-fallback nếu cần dùng component standalone (vd Storybook).
 */
export function useAppSidebar() {
  const ctx = React.useContext(AppSidebarContext);
  if (!ctx) {
    throw new Error('useAppSidebar phải dùng trong AppSidebarProvider');
  }
  return ctx;
}
