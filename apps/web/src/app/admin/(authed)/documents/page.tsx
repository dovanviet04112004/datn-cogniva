/**
 * /admin/documents — list documents cross-user.
 *
 * Client component (filter + cursor pagination). SSR chỉ require admin auth.
 */
import { DocumentsListClient } from '@/components/admin/documents/documents-list-client';

export const dynamic = 'force-dynamic';

export default function AdminDocumentsPage() {
  return <DocumentsListClient />;
}
