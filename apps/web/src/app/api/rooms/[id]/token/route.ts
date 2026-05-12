/**
 * POST /api/rooms/[id]/token — issue LiveKit JWT cho user join room.
 *
 * Flow:
 *   1. Verify user auth.
 *   2. Verify room exists + visibility check.
 *   3. Auto-add user làm MEMBER nếu chưa (UNLISTED/PUBLIC allow self-join,
 *      PRIVATE chỉ allow user đã được mời).
 *   4. Check capacity (active count < maxMembers).
 *   5. Ký JWT TTL 2h, permissions theo role.
 *
 * Phase 13.8 (waiting room) sẽ thêm: nếu requireApproval=TRUE và user chưa
 * ACTIVE → insert PENDING + trả 202.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, room, roomMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { createLivekitToken, getActiveParticipantCount } from '@/lib/livekit';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const BODY_SCHEMA = z.object({
  displayName: z.string().min(1).max(50).optional(),
});

export async function POST(req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // 1. Room exists?
  const [target] = await db.select().from(room).where(eq(room.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const uid = session.user.id;
  const isOwner = target.ownerId === uid;

  // 2. Existing membership
  const [existing] = await db
    .select()
    .from(roomMember)
    .where(and(eq(roomMember.roomId, id), eq(roomMember.userId, uid)))
    .limit(1);

  // BANNED/KICKED → reject
  if (existing && (existing.status === 'BANNED' || existing.status === 'KICKED')) {
    return NextResponse.json(
      { error: existing.status === 'BANNED' ? 'Bạn đã bị ban khỏi phòng' : 'Bạn đã bị kick' },
      { status: 403 },
    );
  }

  // 3. Auto-join nếu UNLISTED/PUBLIC; PRIVATE thì chỉ user đã có membership
  if (!existing) {
    if (target.visibility === 'PRIVATE' && !isOwner) {
      return NextResponse.json({ error: 'Phòng riêng tư, cần được mời' }, { status: 403 });
    }
    // Waiting room (Phase 13.8) — sẽ implement sau, hiện auto-active
    await db.insert(roomMember).values({
      roomId: id,
      userId: uid,
      role: isOwner ? 'OWNER' : 'MEMBER',
      status: 'ACTIVE',
    });
  }

  const myRole = existing?.role ?? (isOwner ? 'OWNER' : 'MEMBER');
  const isMod = myRole === 'OWNER' || myRole === 'MODERATOR';

  // 4. Capacity check qua LiveKit API (lazy — chỉ count khi cần ký token)
  try {
    const active = await getActiveParticipantCount(target.livekitRoomName ?? id);
    if (active >= target.maxMembers && !isMod) {
      return NextResponse.json({ error: `Phòng đã đủ ${target.maxMembers} người` }, { status: 403 });
    }
  } catch (err) {
    // LiveKit unreachable — log nhưng vẫn cho join (degrade gracefully).
    // Capacity sẽ enforce lại client-side qua LiveKit room.maxParticipants.
    console.error('[rooms/token] LiveKit unreachable, skip capacity check:', err);
  }

  // 5. Ký JWT
  const token = await createLivekitToken({
    identity: uid,
    name: parsed.data.displayName ?? session.user.name ?? session.user.email,
    roomName: target.livekitRoomName ?? id,
    isMod,
    ttl: '2h',
    metadata: {
      userId: uid,
      role: myRole,
      avatarUrl: session.user.image,
    },
  });

  // Update lastSeen
  await db
    .update(roomMember)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(roomMember.roomId, id), eq(roomMember.userId, uid)));

  return NextResponse.json({
    token,
    serverUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL,
    roomName: target.livekitRoomName ?? id,
    role: myRole,
  });
}
