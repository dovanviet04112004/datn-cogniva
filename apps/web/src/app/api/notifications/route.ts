/**
 * GET /api/notifications — list notification của user hiện tại + unread count.
 *
 * Query params:
 *   limit (default 20, max 50)
 *   unreadOnly ('1' để chỉ trả notification chưa đọc)
 *
 * Response:
 *   { notifications: [...], unreadCount: number }
 *
 * Dùng cho NotificationBell ở topbar + Notification panel mobile.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db, notificationLog } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get('unreadOnly') === '1';
  const limitRaw = Number(url.searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 20;

  const where = unreadOnly
    ? and(eq(notificationLog.userId, userId), isNull(notificationLog.readAt))
    : eq(notificationLog.userId, userId);

  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        id: notificationLog.id,
        type: notificationLog.type,
        title: notificationLog.title,
        body: notificationLog.body,
        data: notificationLog.data,
        readAt: notificationLog.readAt,
        createdAt: notificationLog.createdAt,
      })
      .from(notificationLog)
      .where(where)
      .orderBy(desc(notificationLog.createdAt))
      .limit(limit),
    db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM "notification_log"
      WHERE user_id = ${userId} AND read_at IS NULL
    `),
  ]);

  return NextResponse.json({
    notifications: rows.map((n) => ({
      ...n,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount: Number(countRow?.n ?? 0),
  });
}
