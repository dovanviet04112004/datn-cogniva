/**
 * POST /api/rooms/[id]/chat — gửi message + broadcast qua Socket.IO.
 * GET  /api/rooms/[id]/chat — fetch 50 message gần nhất (initial load).
 *
 * Flow POST:
 *   1. Verify user là member ACTIVE.
 *   2. Save vào DB trước → broadcast sau (nếu DB fail, không phát message giả).
 *   3. Broadcast `chat:message` tới channel presence-room-{id}.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, roomMember, roomMessage, user } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const POST_SCHEMA = z.object({
  content: z.string().min(1).max(2000),
  type: z.enum(['TEXT', 'FILE', 'AI']).default('TEXT'),
  metadata: z.record(z.unknown()).optional(),
});

/** Helper: verify user là member ACTIVE của room. */
async function assertMember(roomId: string, userId: string) {
  const [m] = await db
    .select()
    .from(roomMember)
    .where(
      and(
        eq(roomMember.roomId, roomId),
        eq(roomMember.userId, userId),
        eq(roomMember.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  return m;
}

export async function GET(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!(await assertMember(id, session.user.id))) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  }

  // Lấy 50 message gần nhất + join user info (loại AI_TUTOR — Phase 15)
  const rows = await db
    .select({
      id: roomMessage.id,
      userId: roomMessage.userId,
      content: roomMessage.content,
      type: roomMessage.type,
      metadata: roomMessage.metadata,
      createdAt: roomMessage.createdAt,
      userName: user.name,
      userImage: user.image,
    })
    .from(roomMessage)
    .leftJoin(user, eq(roomMessage.userId, user.id))
    .where(eq(roomMessage.roomId, id))
    .orderBy(desc(roomMessage.createdAt))
    .limit(50);

  // Reverse để hiển thị chronological (cũ → mới)
  return NextResponse.json({ messages: rows.reverse() });
}

export async function POST(req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!(await assertMember(id, session.user.id))) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [saved] = await db
    .insert(roomMessage)
    .values({
      roomId: id,
      userId: session.user.id,
      content: parsed.data.content,
      type: parsed.data.type,
      metadata: parsed.data.metadata ?? null,
    })
    .returning();

  // Broadcast — không await blocking lâu, vẫn await để bắt error log
  await triggerEvent(`presence-room-${id}`, 'chat:message', {
    id: saved!.id,
    userId: session.user.id,
    userName: session.user.name,
    userImage: session.user.image,
    content: saved!.content,
    type: saved!.type,
    metadata: saved!.metadata,
    createdAt: saved!.createdAt,
  });

  return NextResponse.json({ ok: true, id: saved!.id });
}

// silence unused
void asc;
