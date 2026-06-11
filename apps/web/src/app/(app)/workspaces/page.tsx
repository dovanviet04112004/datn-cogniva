import { redirect } from 'next/navigation';
import { asc, count, desc, eq, sql } from 'drizzle-orm';

import { db, document, workspace } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { WorkspacesDashboardClient } from '@/components/workspaces/workspaces-dashboard-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function WorkspacesPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/workspaces');
  const userId = session.user.id;

  const docCountByWs = db
    .select({
      workspaceId: document.workspaceId,
      n: count(document.id).as('n'),
      lastDocAt: sql<Date | null>`max(${document.createdAt})`.as('last_doc_at'),
    })
    .from(document)
    .where(eq(document.userId, userId))
    .groupBy(document.workspaceId)
    .as('doc_count');

  const [workspaceRows, recentDocRows] = await Promise.all([
    db
      .select({
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        createdAt: workspace.createdAt,
        documentCount: sql<number>`coalesce(${docCountByWs.n}, 0)::int`,
        lastActivityAt: sql<Date | null>`${docCountByWs.lastDocAt}`,
      })
      .from(workspace)
      .leftJoin(docCountByWs, eq(docCountByWs.workspaceId, workspace.id))
      .where(eq(workspace.userId, userId))
      .orderBy(asc(workspace.createdAt)),

    db
      .select({
        id: document.id,
        filename: document.filename,
        createdAt: document.createdAt,
        workspaceId: document.workspaceId,
        workspaceName: workspace.name,
      })
      .from(document)
      .leftJoin(workspace, eq(workspace.id, document.workspaceId))
      .where(eq(document.userId, userId))
      .orderBy(desc(document.createdAt))
      .limit(5),
  ]);

  const totalDocs = workspaceRows.reduce((sum, w) => sum + w.documentCount, 0);

  const toIso = (v: Date | string | null | undefined): string | null =>
    v ? new Date(v).toISOString() : null;

  return (
    <WorkspacesDashboardClient
      workspaces={workspaceRows.map((w) => ({
        ...w,
        createdAt: toIso(w.createdAt)!,
        lastActivityAt: toIso(w.lastActivityAt),
      }))}
      totalDocs={totalDocs}
      recentDocs={recentDocRows.map((d) => ({
        id: d.id,
        filename: d.filename,
        createdAt: toIso(d.createdAt)!,
        workspaceId: d.workspaceId,
        workspaceName: d.workspaceName,
      }))}
    />
  );
}
