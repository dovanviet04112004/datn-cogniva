/**
 * /admin/audit — full audit log với filter UI + diff viewer.
 */
import { AuditLogClient } from '@/components/admin/audit/audit-log-client';

export const dynamic = 'force-dynamic';

export default function AdminAuditPage() {
  return <AuditLogClient />;
}
