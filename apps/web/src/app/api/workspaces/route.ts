/**
 * /api/workspaces — list (GET) + create (POST).
 *
 * GET: trả workspace của user kèm số document trong mỗi cái.
 * POST body { name, description? }: tạo workspace mới.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, document, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      createdAt: workspace.createdAt,
      documentCount: sql<number>`(SELECT count(*)::int FROM "document" WHERE workspace_id = ${workspace.id})`,
    })
    .from(workspace)
    .where(eq(workspace.userId, session.user.id))
    .orderBy(asc(workspace.createdAt));

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
  return NextResponse.json({ workspace: inserted }, { status: 201 });
}

// Re-import để dùng trong file route khác — không cần ở đây
void document;
