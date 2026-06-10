/**
 * ImpersonationBanner — server component hiện banner đỏ khi admin đang
 * impersonate user. Mọi mutation đã bị middleware block; banner nhắc nhở +
 * cho phép stop nhanh.
 *
 * Đặt ngay dưới topbar trong (app)/layout.tsx (sau MaintenanceBanner).
 */
import { getImpersonation } from '@/lib/admin/impersonation';

import { ImpersonationBannerClient } from './impersonation-banner-client';

export async function ImpersonationBanner() {
  const imp = await getImpersonation();
  if (!imp) return null;
  return (
    <ImpersonationBannerClient
      adminEmail={imp.adminEmail}
      targetEmail={imp.targetEmail}
      expiresAt={imp.expiresAt}
      mode={imp.mode}
    />
  );
}
