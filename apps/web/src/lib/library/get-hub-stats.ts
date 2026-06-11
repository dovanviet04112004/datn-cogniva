import { count, eq, sql } from 'drizzle-orm';

import { dbReplica, libraryDoc } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export type LibraryHubStats = {
  total: number;
  totalImports: number;
};

export async function getLibraryHubStats(): Promise<LibraryHubStats> {
  return cached(ck.libraryHubStats(), 3600, async () => {
    const [row] = await dbReplica
      .select({
        total: count(libraryDoc.id),
        totalImports: sql<number>`COALESCE(SUM(${libraryDoc.workspaceImportCount}),0)::int`,
      })
      .from(libraryDoc)
      .where(eq(libraryDoc.status, 'PUBLISHED'));

    return { total: row?.total ?? 0, totalImports: row?.totalImports ?? 0 };
  });
}
