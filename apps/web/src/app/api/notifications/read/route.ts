/**
 * POST /api/notifications/read — mark notifications as read.
 *
 * Body:
 *   ids?: string[]   — mark riêng từng notification (max 100)
 *   all?: boolean    — nếu true, mark TẤT CẢ notification chưa đọc của user
 *
 * Trả về số row affected.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db, notificationLog } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const BODY_SCHEMA = z
  .object({
    ids: z.array(z.string()).max(100).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => !!v.ids?.length || v.all === true, {
    message: 'Cần truyền ids hoặc all=true',
  });

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { ids, all } = parsed.data;

  const now = new Date();
  const updated = all
    ? await db
        .update(notificationLog)
        .set({ readAt: now })
        .where(
          and(eq(notificationLog.userId, userId), isNull(notificationLog.readAt)),
        )
        .returning({ id: notificationLog.id })
    : await db
        .update(notificationLog)
        .set({ readAt: now })
        .where(
          and(
            eq(notificationLog.userId, userId),
            inArray(notificationLog.id, ids!),
          ),
        )
        .returning({ id: notificationLog.id });

  return NextResponse.json({ ok: true, affected: updated.length });
}
