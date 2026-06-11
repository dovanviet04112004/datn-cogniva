/**
 * /admin/security — security settings cho admin account: 2FA TOTP.
 *
 * `twoFactorEnabled` KHÔNG nằm trong claims JWT (cg_at) — đọc thẳng DB,
 * nhất quán với pattern guard admin re-check DB mỗi request.
 */
import { eq } from 'drizzle-orm';

import { db, user } from '@cogniva/db';

import { requireAdmin } from '@/lib/admin/guard';
import { TwoFactorClient } from '@/components/admin/two-factor-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminSecurityPage() {
  const ctx = await requireAdmin();
  const [row] = await db
    .select({ twoFactorEnabled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, ctx.userId))
    .limit(1);
  return <TwoFactorClient enabled={row?.twoFactorEnabled ?? false} />;
}
