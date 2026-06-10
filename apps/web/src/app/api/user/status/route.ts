/**
 * GET / PUT /api/user/status — V2 G3.1 (2026-05-21).
 *
 * Spec: docs/plans/study-group-v2.md §G3.
 *
 * GET: trả status hiện tại của session user (cho UI hydrate).
 * PUT: update status + statusText/statusEmoji optional, broadcast realtime
 *      `presence-user-{userId}` event 'status:change' để mọi group user là
 *      member nhận update realtime (member-sidebar re-render dot màu).
 *
 * `statusExpiresAt` optional — vd "DND trong 1 giờ" → auto-revert 'online'.
 * Background job (cron) sẽ clear expired status; V1 không cần — frontend
 * compute `Date.now() > expiresAt ? 'online' : current` ở render time.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroupMember, user } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

const STATUS_ENUM = z.enum(['online', 'idle', 'dnd', 'offline', 'invisible']);

const PUT_SCHEMA = z
  .object({
    status: STATUS_ENUM.optional(),
    statusText: z.string().max(128).nullable().optional(),
    statusEmoji: z.string().max(8).nullable().optional(),
    /** Số giây cho đến khi auto-clear status (vd 1800 = 30 min). NULL = persist. */
    expiresInSec: z.number().int().min(60).max(60 * 60 * 24 * 7).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Body rỗng' });

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [u] = await db
    .select({
      status: user.status,
      statusText: user.statusText,
      statusEmoji: user.statusEmoji,
      statusExpiresAt: user.statusExpiresAt,
    })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);
  if (!u) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Compute effective status: nếu expired → fallback 'online'
  const effective =
    u.statusExpiresAt && new Date(u.statusExpiresAt).getTime() < Date.now()
      ? 'online'
      : u.status;

  return NextResponse.json({
    status: effective,
    storedStatus: u.status,
    statusText: u.statusText,
    statusEmoji: u.statusEmoji,
    statusExpiresAt: u.statusExpiresAt,
  });
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = PUT_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.statusText !== undefined) updates.statusText = parsed.data.statusText;
  if (parsed.data.statusEmoji !== undefined) updates.statusEmoji = parsed.data.statusEmoji;
  if (parsed.data.expiresInSec !== undefined) {
    updates.statusExpiresAt =
      parsed.data.expiresInSec === null
        ? null
        : new Date(Date.now() + parsed.data.expiresInSec * 1000);
  }

  const [updated] = await db
    .update(user)
    .set(updates)
    .where(eq(user.id, session.user.id))
    .returning({
      status: user.status,
      statusText: user.statusText,
      statusEmoji: user.statusEmoji,
      statusExpiresAt: user.statusExpiresAt,
    });

  // V2 G3: broadcast tới MỌI group user là member để member-sidebar realtime
  // re-render status dot. Self-channel `presence-user-{id}` không có listener
  // peer; phải fan-out tới `presence-group-{gid}` của các group.
  // Fire-and-forget, không block response. Realtime tự batch.
  void (async () => {
    try {
      const groups = await db
        .select({ groupId: studyGroupMember.groupId })
        .from(studyGroupMember)
        .where(eq(studyGroupMember.userId, session.user.id));
      const payload = {
        userId: session.user.id,
        status: updated?.status,
        statusText: updated?.statusText,
        statusEmoji: updated?.statusEmoji,
      };
      for (const g of groups) {
        void triggerEvent(`presence-group-${g.groupId}`, 'status:change', payload);
      }
    } catch (err) {
      console.warn('[user/status] broadcast fail:', err);
    }
  })();

  return NextResponse.json({ status: updated });
}
