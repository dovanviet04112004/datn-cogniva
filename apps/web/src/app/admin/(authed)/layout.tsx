/**
 * Admin authed layout — wrap toàn bộ route admin TRỪ /admin/sign-in.
 *
 * Route group `(authed)` không ảnh hưởng URL → /admin/users vẫn là
 * /admin/users, không phải /admin/(authed)/users. /admin/sign-in nằm
 * ngoài group này nên không bị requireAdmin chặn.
 *
 * Server component: requireAdmin() redirect /admin/sign-in nếu fail.
 * AdminShell render dark theme cố định để khác biệt với app user.
 */
import { AdminShell } from '@/components/admin/admin-shell';
import { requireAdmin } from '@/lib/admin/guard';
import { ConfirmProvider } from '@/lib/use-confirm';

export const metadata = {
  title: 'Cogniva Admin',
  robots: { index: false, follow: false },
};

export default async function AdminAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();
  return (
    <ConfirmProvider>
      <AdminShell admin={admin}>{children}</AdminShell>
    </ConfirmProvider>
  );
}
