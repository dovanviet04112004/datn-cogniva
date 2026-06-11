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
    <div className="dark flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <AdminSidebar role={admin.role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminTopbar admin={admin} />
        <main className="flex-1 overflow-y-auto bg-slate-950">{children}</main>
      </div>
    </div>
  );
}
