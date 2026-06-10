/**
 * /admin/users — list users với search + filter + cursor pagination.
 *
 * Client component (fetch /api/admin/users qua client để filter realtime).
 * Server-side initial fetch không cần thiết — list view này luôn dynamic.
 *
 * Layout: header với search + filter chips + table dày 36px row.
 */
import { UsersListClient } from '@/components/admin/users/users-list-client';

export const dynamic = 'force-dynamic';

export default function AdminUsersPage() {
  return <UsersListClient />;
}
