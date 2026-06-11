import { MaintenanceClient } from '@/components/admin/system/maintenance-client';
import { getMaintenanceConfig } from '@/lib/system/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminMaintenancePage() {
  const config = await getMaintenanceConfig();
  return <MaintenanceClient initial={config} />;
}
