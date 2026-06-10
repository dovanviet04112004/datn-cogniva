/**
 * GET /api/admin/documents — list documents cross-user với filter + cursor pagination.
 *
 * Query params:
 *   q          — search substring trong filename
 *   status     — UPLOADING | PROCESSING | READY | FAILED
 *   mime       — substring trong mime type (vd 'pdf')
 *   userEmail  — substring trong email của owner
 *   cursor     — createdAt ISO row cuối trang trước
 *   limit      — default 50, max 100
 *
 * Response:
 *   { documents: [...], nextCursor: string | null, total: number | null }
 *
 * Auth: requireAdminRole — mọi role (SUPER_ADMIN / ADMIN / SUPPORT).
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, ilike, lt, sql } from 'drizzle-orm';

import { db, document, user, workspace } from '@cogniva/db';

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
  const status = url.searchParams.get('status');
  const mime = url.searchParams.get('mime')?.trim() ?? '';
  const userEmail = url.searchParams.get('userEmail')?.trim() ?? '';
  const cursor = url.searchParams.get('cursor');
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 50;

  // ── Build WHERE conditions ────────────────────────────
  const conditions = [] as Parameters<typeof and>[number][];
  if (q) conditions.push(ilike(document.filename, `%${q}%`));
  if (
    status === 'UPLOADING' ||
    status === 'PROCESSING' ||
    status === 'READY' ||
    status === 'FAILED'
  ) {
    conditions.push(eq(document.status, status));
  }
  if (mime) conditions.push(ilike(document.mimeType, `%${mime}%`));
  if (userEmail) conditions.push(ilike(user.email, `%${userEmail}%`));
  if (cursor) {
    const parsed = new Date(cursor);
    if (!Number.isNaN(parsed.getTime())) {
      conditions.push(lt(document.createdAt, parsed));
    }
  }

  // ── Query — join user + workspace, fetch limit+1 để biết hasMore ──
  const rows = await db
    .select({
      id: document.id,
      filename: document.filename,
      mimeType: document.mimeType,
      size: document.size,
      status: document.status,
      createdAt: document.createdAt,
      userId: document.userId,
      userName: user.name,
      userEmail: user.email,
      workspaceId: document.workspaceId,
      workspaceName: workspace.name,
    })
    .from(document)
    .leftJoin(user, eq(user.id, document.userId))
    .leftJoin(workspace, eq(workspace.id, document.workspaceId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(document.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && trimmed.length > 0
    ? trimmed[trimmed.length - 1]!.createdAt.toISOString()
    : null;

  // Total chỉ count khi không có filter (cache UX)
  let total: number | null = null;
  if (conditions.length === 0) {
    const [row] = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM "document"`,
    );
    total = Number(row?.n ?? 0);
  }

  return NextResponse.json({
    documents: trimmed.map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
    })),
    nextCursor,
    total,
  });
}
