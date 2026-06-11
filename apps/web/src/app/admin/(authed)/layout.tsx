import { AdminShell } from '@/components/admin/admin-shell';
import { requireAdmin } from '@/lib/admin/guard';
import { ConfirmProvider } from '@/lib/use-confirm';

export const metadata = {
  title: 'Cogniva Admin',
  robots: { index: false, follow: false },
};

export default async function AdminAuthedLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <ConfirmProvider>
      <AdminShell admin={admin}>{children}</AdminShell>
    </ConfirmProvider>
  );
}
