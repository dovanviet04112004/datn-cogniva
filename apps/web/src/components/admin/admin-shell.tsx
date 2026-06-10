/**
 * AdminShell — layout shell tách biệt cho /admin/*.
 *
 * KHÔNG import gì từ (app)/ (AppSidebar, AppTopbar, …) để giữ nguyên
 * nguyên tắc "zero leak" giữa admin và product (docs/plans/admin.md §1.1).
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │ AdminTopbar (h-12, glass)            │
 *   ├──────┬───────────────────────────────┤
 *   │ Side │  content area (overflow-auto) │
 *   │ 240px│                               │
 *   └──────┴───────────────────────────────┘
 *
 * Dark theme default — visual cue rằng đây là môi trường khác app user.
 */
import * as React from 'react';

import { AdminSidebar } from './admin-sidebar';
import { AdminTopbar } from './admin-topbar';
import type { AdminContext } from '@/lib/admin/guard';

export function AdminShell({
  admin,
  children,
}: {
  admin: AdminContext;
  children: React.ReactNode;
}) {
  return (
    // dark class force theme — admin luôn dark mode để khác app
    <div className="dark flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <AdminSidebar role={admin.role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminTopbar admin={admin} />
        <main className="flex-1 overflow-y-auto bg-slate-950">{children}</main>
      </div>
    </div>
  );
}
