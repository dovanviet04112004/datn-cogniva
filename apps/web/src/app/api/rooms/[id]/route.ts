/**
 * /api/rooms/[id] — get one (GET) + delete (DELETE).
 *
 * GET: trả room + danh sách member (nếu user có quyền xem).
 *   - User là member ACTIVE / OWNER / MODERATOR → trả full.
 *   - Visibility PUBLIC + không phải member → trả room info (không có member list).
 *   - Còn lại → 404 (giấu sự tồn tại).
 *
 * DELETE: chỉ owner xoá được. Cascade member/message/event/recording.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, room, roomMember, user } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onRoomChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const uid = session.user.id;

  // 1. Fetch room
  const [target] = await db.select().from(room).where(eq(room.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 2. Fetch members ACTIVE join với user info
  const members = await db
    .select({
      id: roomMember.id,
      userId: roomMember.userId,
      role: roomMember.role,
      status: roomMember.status,
      joinedAt: roomMember.joinedAt,
      lastSeenAt: roomMember.lastSeenAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(roomMember)
    .innerJoin(user, eq(roomMember.userId, user.id))
    .where(and(eq(roomMember.roomId, id), eq(roomMember.status, 'ACTIVE')));

  const isOwner = target.ownerId === uid;
  const myMembership = members.find((m) => m.userId === uid);
  const canSeeMembers = isOwner || myMembership !== undefined;

  if (!canSeeMembers && target.visibility === 'PRIVATE') {
    // Giấu PRIVATE room — trả 404 chứ không 403 (anti-enumeration)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    room: {
      ...target,
      members: canSeeMembers ? members : undefined,
      myRole: myMembership?.role ?? (isOwner ? 'OWNER' : null),
    },
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Verify owner trước khi xoá
  const [target] = await db.select().from(room).where(eq(room.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (target.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.delete(room).where(and(eq(room.id, id), eq(room.ownerId, session.user.id)));

  // Room bị xoá → biến mất khỏi list "mine" của owner → bust cache.
  await onRoomChanged(session.user.id);

  return NextResponse.json({ ok: true });
}
