import { apiServerOrNull } from '@/lib/api-server';

import { MaintenanceBannerClient } from './maintenance-banner-client';

type MaintenanceConfig = {
  enabled: boolean;
  banner: string | null;
  dismissible: boolean;
};

export async function MaintenanceBanner() {
  const config = await apiServerOrNull<MaintenanceConfig>('/api/system/maintenance').catch(
    () => null,
  );
  if (!config?.enabled || !config.banner) return null;
  return <MaintenanceBannerClient banner={config.banner} dismissible={config.dismissible} />;
}
