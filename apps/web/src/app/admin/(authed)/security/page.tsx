/**
 * /admin/security — security settings cho admin account: 2FA TOTP.
 */
import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { requireAdmin } from '@/lib/admin/guard';
import { TwoFactorClient } from '@/components/admin/two-factor-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminSecurityPage() {
  await requireAdmin();
  const session = await auth.api.getSession({ headers: await headers() });
  // session.user.twoFactorEnabled — plugin tự inject vào additional fields
  const enabled =
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled ??
    false;
  return <TwoFactorClient enabled={enabled} />;
}
