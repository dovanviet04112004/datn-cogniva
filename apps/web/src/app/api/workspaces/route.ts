/**
 * /api/workspaces — list (GET) + create (POST).
 *
 * GET: trả workspace của user kèm số document trong mỗi cái.
 * POST body { name, description? }: tạo workspace mới.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { asc, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, dbReplica, document, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';
import { onWorkspaceChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Sidebar workspaces là read thuần, hot nhất (mọi page app-shell gọi) →
  // cache-aside per-user, TTL 120s. Đọc qua replica (không read-your-own-write
  // trong cùng request); POST tạo workspace đã bust key này qua onWorkspaceChanged.
  const rows = await cached(ck.workspaces(session.user.id), 120, async () => {
    // Subquery aggregate count(document) theo workspaceId — tránh correlated
    // subquery (drizzle sql template không reference column outer scope đúng).
    const countByWorkspace = dbReplica
      .select({
        workspaceId: document.workspaceId,
        n: count(document.id).as('n'),
      })
      .from(document)
      .where(eq(document.userId, session.user.id))
      .groupBy(document.workspaceId)
      .as('doc_count');

    // documentCount là số nguyên, createdAt được client serialize qua JSON
    // (NextResponse.json) nên giữ nguyên — không cần re-hydrate Date.
    return dbReplica
      .select({
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        createdAt: workspace.createdAt,
        documentCount: sql<number>`coalesce(${countByWorkspace.n}, 0)::int`,
      })
      .from(workspace)
      .leftJoin(countByWorkspace, eq(countByWorkspace.workspaceId, workspace.id))
      .where(eq(workspace.userId, session.user.id))
      .orderBy(asc(workspace.createdAt));
  });

  return NextResponse.json({ workspaces: rows });
}

const CREATE_SCHEMA = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [inserted] = await db
    .insert(workspace)
    .values({
      userId: session.user.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    })
    .returning();

  // Workspace mới → bust sidebar list cache của user (TTL 120s không đủ tươi cho
  // UX tạo-rồi-thấy-ngay). Gọi SAU .returning() thành công, trước khi trả response.
  await onWorkspaceChanged(session.user.id);

  return NextResponse.json({ workspace: inserted }, { status: 201 });
}

// Re-import để dùng trong file route khác — không cần ở đây
void document;
