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
