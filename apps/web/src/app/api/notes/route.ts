/**
 * /api/notes — list (GET) + create (POST).
 *
 * GET ?limit=50&offset=0&workspaceId=X
 *   - workspaceId=X       → chỉ notes thuộc workspace X
 *   - workspaceId="null"  → notes "Personal" (chưa thuộc workspace)
 *   - bỏ qua              → tất cả notes của user (cross-workspace)
 * POST body { title, content, workspaceId?, conceptId?, documentId? }  → tạo note.
 *   - workspaceId optional — frontend có thể pass cụ thể, null cho "Personal".
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db, note } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onWorkspaceContentChanged } from '@/lib/cache/invalidate';
import { awardXp, XP_AMOUNTS } from '@/lib/gamification/xp';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);
  const workspaceParam = url.searchParams.get('workspaceId');

  // Build where clause — userId always required; workspaceId optional
  // workspaceParam === "null" → isNull(workspaceId) (notes "Personal")
  // workspaceParam === "X"    → eq(workspaceId, X)
  // workspaceParam === null   → no extra filter (all notes)
  const conditions = [eq(note.userId, session.user.id)];
  if (workspaceParam === 'null') {
    conditions.push(isNull(note.workspaceId));
  } else if (workspaceParam) {
    conditions.push(eq(note.workspaceId, workspaceParam));
  }

  const rows = await db
    .select({
      id: note.id,
      title: note.title,
      content: note.content,
      workspaceId: note.workspaceId,
      conceptId: note.conceptId,
      documentId: note.documentId,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })
    .from(note)
    .where(and(...conditions))
    .orderBy(desc(note.updatedAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({ notes: rows });
}

const CREATE_SCHEMA = z.object({
  title: z.string().min(1).max(200).default('Untitled'),
  content: z.string().default(''),
  workspaceId: z.string().nullable().optional(),
  conceptId: z.string().optional(),
  documentId: z.string().optional(),
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
    .insert(note)
    .values({
      userId: session.user.id,
      workspaceId: parsed.data.workspaceId ?? null,
      title: parsed.data.title,
      content: parsed.data.content,
      conceptId: parsed.data.conceptId ?? null,
      documentId: parsed.data.documentId ?? null,
    })
    .returning();

  // Gamification: +3 XP cho mỗi note tạo mới + check achievement first_note
  await awardXp(session.user.id, XP_AMOUNTS.NOTE_CREATE, {
    source: 'note',
    totalCount: 1,
  });

  // Note mới đổi badge stats của workspace (count notes) → bust workspaceStats/atoms.
  // Chỉ khi note thuộc 1 workspace cụ thể; note "Personal" (workspaceId=null) không
  // ảnh hưởng stats workspace nào.
  if (inserted?.workspaceId) {
    await onWorkspaceContentChanged(session.user.id, inserted.workspaceId);
  }

  return NextResponse.json({ note: inserted }, { status: 201 });
}
