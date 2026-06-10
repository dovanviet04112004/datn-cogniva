/**
 * /admin/groups — list study groups cross-user.
 */
import { GroupsListClient } from '@/components/admin/groups/groups-list-client';

export const dynamic = 'force-dynamic';

export default function AdminGroupsPage() {
  return <GroupsListClient />;
}
