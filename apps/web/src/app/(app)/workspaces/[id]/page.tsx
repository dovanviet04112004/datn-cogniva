/**
 * /workspaces/[id] — workspace detail page V5.
 *
 * Spec: docs/plans/v5-notebooklm-layout.md.
 *
 * V5 layout: 3 cột Sources · Chat · Studio (thay vì tabs). Server chỉ
 * fetch workspace meta + documents — phần atoms/notes Sources panel tự
 * fetch client-side qua API.
 *
 * Backward-compat: query string `?view=session|flashcard|quiz|...` deep
 * link vào recipe.
 */
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, count, desc, eq, sql } from 'drizzle-orm';

import { chunk, db, document, workspace } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { WorkspaceNotebook } from '@/components/workspaces/v5/workspace-notebook';

/** Cookie persist trạng thái panel — đọc SSR tránh flicker (V6). */
const SOURCES_COOKIE = 'cogniva.ws-sources-open';
const STUDIO_COOKIE = 'cogniva.ws-studio-open';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function WorkspaceDetailPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');

  const { id } = await params;

  // Workspace + ownership
  const [ws] = await db
    .select()
    .from(workspace)
    .where(and(eq(workspace.id, id), eq(workspace.userId, session.user.id)))
    .limit(1);
  if (!ws) notFound();

  // Documents trong workspace + chunkCount (cần cho Sources panel hiển thị
  // metadata page count + chunks)
  const chunkCount = db
    .select({ documentId: chunk.documentId, n: count(chunk.id).as('n') })
    .from(chunk)
    .groupBy(chunk.documentId)
    .as('chunk_count');

  const documents = await db
    .select({
      id: document.id,
      filename: document.filename,
      mimeType: document.mimeType,
      size: document.size,
      status: document.status,
      createdAt: document.createdAt,
      pageCount: sql<number | null>`(${document.metadata}->>'pageCount')::int`,
      chunks: sql<number>`coalesce(${chunkCount.n}, 0)::int`,
    })
    .from(document)
    .leftJoin(chunkCount, eq(document.id, chunkCount.documentId))
    .where(eq(document.workspaceId, id))
    .orderBy(desc(document.createdAt));

  // V6: cookie-persist panel state — đọc server-side tránh flicker khi reload.
  // Default cả 2 đều OPEN cho user mới (cookie chưa set).
  const cookieStore = await cookies();
  const sourcesCookie = cookieStore.get(SOURCES_COOKIE)?.value;
  const studioCookie = cookieStore.get(STUDIO_COOKIE)?.value;
  const initialSourcesOpen = sourcesCookie !== 'false';
  const initialStudioOpen = studioCookie !== 'false';

  return (
    <WorkspaceNotebook
      workspace={{
        id: ws.id,
        name: ws.name,
        description: ws.description,
        createdAt: ws.createdAt.toISOString(),
      }}
      documents={documents.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      }))}
      initialSourcesOpen={initialSourcesOpen}
      initialStudioOpen={initialStudioOpen}
    />
  );
}
