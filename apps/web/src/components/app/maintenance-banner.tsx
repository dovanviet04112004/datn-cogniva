/**
 * MaintenanceBanner — server component fetch maintenance config + render banner.
 *
 * Đặt ngay dưới topbar trong (app)/layout.tsx. Khi disabled → không render gì
 * (null). Khi enabled → banner amber với nút dismiss (nếu dismissible).
 *
 * Dismiss state lưu sessionStorage key 'cogniva.maintenance.dismissedAt' với
 * timestamp config được update. Khi admin update banner mới → timestamp khác
 * → reset dismiss. Implementation: pass updatedAt qua data attr, client check.
 *
 * SSR config cached 5s (xem `getMaintenanceConfig`) — không lo dồn DB.
 */
import { getMaintenanceConfig } from '@/lib/system/config';

import { MaintenanceBannerClient } from './maintenance-banner-client';

export async function MaintenanceBanner() {
  const config = await getMaintenanceConfig();
  if (!config.enabled || !config.banner) return null;
  return (
    <MaintenanceBannerClient
      banner={config.banner}
      dismissible={config.dismissible}
    />
  );
}
