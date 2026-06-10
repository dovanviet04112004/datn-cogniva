/**
 * POST /api/realtime/auth — endpoint NỘI BỘ cho Socket.IO gateway (apps/realtime).
 *
 * Gateway gọi (server-to-server, forward credential của client) ở 2 thời điểm:
 *   1. CONNECT  : body `{}` (không channel) → chỉ verify session → trả `{ user }` (whoami).
 *   2. SUBSCRIBE: body `{ channel }` → verify session + authorize membership channel →
 *      200 `{ user }` nếu được, 401/403 nếu không.
 *
 * Credential: cookie (web) HOẶC `Authorization: Bearer <token>` (mobile, Better Auth bearer
 * plugin) — `auth.api.getSession` đọc cả hai từ headers.
 *
 * Luật authorize (GIỮ NGUYÊN từ thời Pusher):
 *   - presence-room-{roomId}      : roomMember status ACTIVE
 *   - presence-user-{userId}      : chỉ chính chủ
 *   - presence-group-{groupId}    : member của group
 *   - private-channel-{channelId} : member group chứa channel
 *   - presence-voice-{channelId}  : member group + channel.type ∈ {VOICE, STAGE}
 *   - private-dm-{threadId}        : thành viên thread
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import {
  db,
  dmThread,
  roomMember,
  studyGroupChannel,
  studyGroupMember,
} from '@cogniva/db';

import { isThreadMember } from '@/lib/group/dm';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

/** Kiểm tra user có là member của group không. */
async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, groupId), eq(studyGroupMember.userId, userId)),
    )
    .limit(1);
  return !!m;
}

/** Kiểm tra user có quyền vào channel này không (qua groupId của channel). */
async function canAccessChannel(
  channelId: string,
  userId: string,
): Promise<{ ok: boolean; type?: string }> {
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId, type: studyGroupChannel.type })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return { ok: false };
  const member = await isGroupMember(ch.groupId, userId);
  return { ok: member, type: ch.type };
}

/** Authorize 1 channel — trả true nếu user được vào. */
async function authorize(channel: string, uid: string): Promise<boolean> {
  if (channel.startsWith('presence-room-')) {
    const roomId = channel.replace('presence-room-', '');
    const [member] = await db
      .select({ id: roomMember.id })
      .from(roomMember)
      .where(
        and(
          eq(roomMember.roomId, roomId),
          eq(roomMember.userId, uid),
          eq(roomMember.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return !!member;
  }
  if (channel.startsWith('presence-user-')) {
    return channel.replace('presence-user-', '') === uid;
  }
  if (channel.startsWith('presence-group-')) {
    return isGroupMember(channel.replace('presence-group-', ''), uid);
  }
  if (channel.startsWith('private-channel-')) {
    const res = await canAccessChannel(channel.replace('private-channel-', ''), uid);
    return res.ok;
  }
  if (channel.startsWith('presence-voice-')) {
    const res = await canAccessChannel(channel.replace('presence-voice-', ''), uid);
    // VOICE và STAGE channel đều dùng prefix presence-voice- (cùng LiveKit room).
    return res.ok && (res.type === 'VOICE' || res.type === 'STAGE');
  }
  if (channel.startsWith('private-dm-')) {
    const threadId = channel.replace('private-dm-', '');
    const [t] = await db.select().from(dmThread).where(eq(dmThread.id, threadId)).limit(1);
    return !!t && isThreadMember(t, uid);
  }
  return false; // channel không hợp lệ
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { channel } = (await req.json().catch(() => ({}))) as { channel?: string };
  const uid = session.user.id;

  // SUBSCRIBE: có channel → phải authorize. CONNECT: không channel → bỏ qua, chỉ whoami.
  if (channel) {
    const ok = await authorize(channel, uid);
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    user: { id: uid, name: session.user.name, image: session.user.image },
  });
}
