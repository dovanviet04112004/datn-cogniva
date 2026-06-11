import { getMaintenanceConfig } from '@/lib/system/config';

import { MaintenanceBannerClient } from './maintenance-banner-client';

export async function MaintenanceBanner() {
  const config = await getMaintenanceConfig();
  if (!config.enabled || !config.banner) return null;
  return <MaintenanceBannerClient banner={config.banner} dismissible={config.dismissible} />;
}
