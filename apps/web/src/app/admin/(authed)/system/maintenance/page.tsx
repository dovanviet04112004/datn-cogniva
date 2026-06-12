import { MaintenanceClient } from '@/components/admin/system/maintenance-client';
import { apiServer } from '@/lib/api-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MaintenanceConfig = {
  enabled: boolean;
  banner: string | null;
  dismissible: boolean;
};

export default async function AdminMaintenancePage() {
  const { config } = await apiServer<{ config: MaintenanceConfig }>(
    '/api/admin/system/maintenance',
  );
  return <MaintenanceClient initial={config} />;
}
