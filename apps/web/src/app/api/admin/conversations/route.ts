/**
 * GET /api/admin/conversations — list 100 conversation gần nhất cross-user.
 *
 * Query params:
 *   q          — search substring trên title
 *   userEmail  — filter substring email owner
 *   cursor     — createdAt ISO row cuối
 *   limit      — max 100, default 50
 *
 * Trả kèm:
 *   messageCount — count message của conversation đó
 *   lastMessageAt — createdAt message mới nhất
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, ilike, lt, sql } from 'drizzle-orm';

import { conversation, db, message, user, workspace } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;

export async function GET(request: Request) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const userEmail = url.searchParams.get('userEmail')?.trim() ?? '';
  const cursor = url.searchParams.get('cursor');
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 50;

  const conditions = [] as Parameters<typeof and>[number][];
  if (q) conditions.push(ilike(conversation.title, `%${q}%`));
  if (userEmail) conditions.push(ilike(user.email, `%${userEmail}%`));
  if (cursor) {
    const parsed = new Date(cursor);
    if (!Number.isNaN(parsed.getTime())) {
      conditions.push(lt(conversation.createdAt, parsed));
    }
  }

  // Subquery dùng SQL raw để lấy messageCount + lastMessageAt — join LATERAL
  // sẽ cleaner nhưng drizzle chưa hỗ trợ trực tiếp. Dùng SUBSELECT inline.
  const rows = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      userId: conversation.userId,
      userName: user.name,
      userEmail: user.email,
      workspaceId: conversation.workspaceId,
      workspaceName: workspace.name,
      messageCount: sql<number>`(
        SELECT COUNT(*)::int FROM "message" WHERE "message".conversation_id = ${conversation.id}
      )`,
      lastMessageAt: sql<string | null>`(
        SELECT MAX(created_at)::text FROM "message" WHERE "message".conversation_id = ${conversation.id}
      )`,
    })
    .from(conversation)
    .leftJoin(user, eq(user.id, conversation.userId))
    .leftJoin(workspace, eq(workspace.id, conversation.workspaceId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(conversation.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && trimmed.length > 0
      ? trimmed[trimmed.length - 1]!.createdAt.toISOString()
      : null;

  let total: number | null = null;
  if (conditions.length === 0) {
    const [r] = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM "conversation"`,
    );
    total = Number(r?.n ?? 0);
  }

  // Cast Drizzle row type — messageCount đến từ sql<number> đã chuẩn
  return NextResponse.json({
    conversations: trimmed.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      // message.created_at::text trả về 'YYYY-MM-DD HH:MM:SS' — chuyển ISO để client hiển thị
      lastMessageAt: c.lastMessageAt
        ? new Date(c.lastMessageAt as unknown as string).toISOString()
        : null,
    })),
    nextCursor,
    total,
  });
}
