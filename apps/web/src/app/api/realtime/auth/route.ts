/**
 * POST /api/realtime/auth — Soketi auth endpoint cho presence/private channel.
 *
 * Pusher-js client gọi endpoint này trước khi subscribe `presence-room-XXX`
 * hoặc `private-XXX`. Server verify user có quyền vào channel, rồi sign
 * payload với SOKETI_SECRET → trả về client.
 *
 * Channel naming convention:
 *   - presence-room-{roomId}   : user phải là member ACTIVE
 *   - presence-user-{userId}   : chỉ chính user đó được sub (notification 1-1)
 *   - presence-exam-{examId}   : Phase 17 — live exam
 *
 * Pusher protocol: nhận body x-www-form-urlencoded
 *   socket_id=12345.67890&channel_name=presence-room-abc
 *
 * Trả response: { auth: 'app-key:signature', channel_data: '{...}' }
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, roomMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { authorizeChannel } from '@/lib/realtime-server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const socketId = String(formData.get('socket_id') ?? '');
  const channel = String(formData.get('channel_name') ?? '');
  if (!socketId || !channel) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  const uid = session.user.id;

  // Verify quyền vào channel
  if (channel.startsWith('presence-room-')) {
    const roomId = channel.replace('presence-room-', '');
    const [member] = await db
      .select()
      .from(roomMember)
      .where(
        and(
          eq(roomMember.roomId, roomId),
          eq(roomMember.userId, uid),
          eq(roomMember.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!member) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (channel.startsWith('presence-user-')) {
    const targetUserId = channel.replace('presence-user-', '');
    if (targetUserId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: 'Unknown channel' }, { status: 400 });
  }

  try {
    const authData = authorizeChannel(socketId, channel, {
      user_id: uid,
      user_info: {
        name: session.user.name,
        image: session.user.image,
      },
    });
    return NextResponse.json(authData);
  } catch (err) {
    console.error('[realtime/auth] sign fail:', err);
    return NextResponse.json({ error: 'Sign failed' }, { status: 500 });
  }
}
