/**
 * POST /api/rooms/[id]/moderate — mod action endpoint.
 *
 * Actions:
 *   - KICK: ép user disconnect khỏi LiveKit + update roomMember status = KICKED.
 *   - MUTE: ép tắt mic của user.
 *   - UNMUTE_REQUEST: chỉ gửi tín hiệu (LiveKit không cho ép bật mic vì privacy).
 *   - LOCK: room.metadata.locked = true → user mới không join được.
 *   - APPROVE: chuyển roomMember status PENDING → ACTIVE (Phase 13.8 waiting room).
 *   - REJECT: chuyển status sang BANNED (waiting room reject).
 *   - PROMOTE: nâng MEMBER → MODERATOR (owner only).
 *   - DEMOTE:  hạ MODERATOR → MEMBER (owner only).
 *
 * Permissions:
 *   - OWNER: tất cả actions.
 *   - MODERATOR: KICK, MUTE, UNMUTE_REQUEST, APPROVE, REJECT (không promote/demote/lock).
 *   - MEMBER: 403.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, room, roomMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { getRoomService } from '@/lib/livekit';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const ACTION_SCHEMA = z.discriminatedUnion('action', [
  z.object({ action: z.literal('KICK'), targetUserId: z.string() }),
  z.object({ action: z.literal('MUTE'), targetUserId: z.string() }),
  z.object({ action: z.literal('UNMUTE_REQUEST'), targetUserId: z.string() }),
  z.object({ action: z.literal('LOCK'), locked: z.boolean() }),
  z.object({ action: z.literal('APPROVE'), targetUserId: z.string() }),
  z.object({ action: z.literal('REJECT'), targetUserId: z.string() }),
  z.object({ action: z.literal('PROMOTE'), targetUserId: z.string() }),
  z.object({ action: z.literal('DEMOTE'), targetUserId: z.string() }),
]);

export async function POST(req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: roomId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = ACTION_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify caller role
  const [callerMember] = await db
    .select()
    .from(roomMember)
    .where(and(eq(roomMember.roomId, roomId), eq(roomMember.userId, session.user.id)))
    .limit(1);
  const isOwner = callerMember?.role === 'OWNER';
  const isMod = callerMember?.role === 'MODERATOR' || isOwner;
  if (!isMod) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { action } = parsed.data;
  const ownerOnly = ['LOCK', 'PROMOTE', 'DEMOTE'];
  if (ownerOnly.includes(action) && !isOwner) {
    return NextResponse.json({ error: 'Chỉ owner được phép' }, { status: 403 });
  }

  // Lấy livekitRoomName để gọi RoomService
  const [target] = await db.select().from(room).where(eq(room.id, roomId)).limit(1);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const lkRoom = target.livekitRoomName ?? roomId;

  try {
    switch (parsed.data.action) {
      case 'KICK': {
        const { targetUserId } = parsed.data;
        // 1. Disconnect khỏi LiveKit
        try {
          await getRoomService().removeParticipant(lkRoom, targetUserId);
        } catch (err) {
          // LiveKit có thể chưa biết participant nếu chưa join → bỏ qua
          console.warn('[moderate/KICK] LiveKit removeParticipant fail:', err);
        }
        // 2. Update DB
        await db
          .update(roomMember)
          .set({ status: 'KICKED' })
          .where(and(eq(roomMember.roomId, roomId), eq(roomMember.userId, targetUserId)));
        // 3. Notify user qua personal channel
        await triggerEvent(`presence-user-${targetUserId}`, 'room:kicked', { roomId });
        break;
      }

      case 'MUTE': {
        const { targetUserId } = parsed.data;
        try {
          // Lấy track audio của user và mute
          const participants = await getRoomService().listParticipants(lkRoom);
          const p = participants.find((x) => x.identity === targetUserId);
          const audioTrack = p?.tracks.find((t) => t.source === 1 /* MICROPHONE */);
          if (audioTrack) {
            await getRoomService().mutePublishedTrack(lkRoom, targetUserId, audioTrack.sid, true);
          }
        } catch (err) {
          console.warn('[moderate/MUTE] fail:', err);
        }
        break;
      }

      case 'UNMUTE_REQUEST': {
        const { targetUserId } = parsed.data;
        // Chỉ gửi tín hiệu — LiveKit không force unmute được (privacy)
        await triggerEvent(`presence-user-${targetUserId}`, 'room:unmute-request', { roomId });
        break;
      }

      case 'LOCK': {
        const { locked } = parsed.data;
        await getRoomService().updateRoomMetadata(lkRoom, JSON.stringify({ locked }));
        await triggerEvent(`presence-room-${roomId}`, 'room:lock-changed', { locked });
        break;
      }

      case 'APPROVE': {
        const { targetUserId } = parsed.data;
        await db
          .update(roomMember)
          .set({ status: 'ACTIVE', joinedAt: new Date() })
          .where(and(eq(roomMember.roomId, roomId), eq(roomMember.userId, targetUserId)));
        await triggerEvent(`presence-user-${targetUserId}`, 'room:approved', { roomId });
        break;
      }

      case 'REJECT': {
        const { targetUserId } = parsed.data;
        await db
          .update(roomMember)
          .set({ status: 'BANNED' })
          .where(and(eq(roomMember.roomId, roomId), eq(roomMember.userId, targetUserId)));
        await triggerEvent(`presence-user-${targetUserId}`, 'room:rejected', { roomId });
        break;
      }

      case 'PROMOTE':
        await db
          .update(roomMember)
          .set({ role: 'MODERATOR' })
          .where(and(eq(roomMember.roomId, roomId), eq(roomMember.userId, parsed.data.targetUserId)));
        break;

      case 'DEMOTE':
        await db
          .update(roomMember)
          .set({ role: 'MEMBER' })
          .where(and(eq(roomMember.roomId, roomId), eq(roomMember.userId, parsed.data.targetUserId)));
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[moderate] action fail:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
