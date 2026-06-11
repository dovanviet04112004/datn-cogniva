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

export function useAppSidebar() {
  const ctx = React.useContext(AppSidebarContext);
  if (!ctx) {
    throw new Error('useAppSidebar phải dùng trong AppSidebarProvider');
  }
  return ctx;
}
