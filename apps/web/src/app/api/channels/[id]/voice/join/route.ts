/**
 * POST /api/channels/[id]/voice/join — explicit insert voice_state row khi
 * client connect tới LiveKit, KHÔNG phụ thuộc webhook.
 *
 * Dev workflow: LiveKit webhook cần public URL (ngrok / Cloudflare Tunnel).
 * Local-only dev → webhook không fire → DB voice_state trống → inline list
 * dưới channel name trong sidebar không có data.
 *
 * Fix: client gọi endpoint này trong `onConnected` của LiveKitRoom → server
 * upsert row + emit `voice:join` qua Socket.IO → inline list refresh ngay.
 *
 * Idempotent: ON CONFLICT (userId) → UPDATE channelId + joinedAt. Cùng
 * pattern với webhook handler.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupVoiceState,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify channel exists + user là member
  const [channel] = await db
    .select({ id: studyGroupChannel.id, groupId: studyGroupChannel.groupId, type: studyGroupChannel.type })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  if (channel.type !== 'VOICE' && channel.type !== 'STAGE') {
    return NextResponse.json({ error: 'Channel không phải VOICE/STAGE' }, { status: 400 });
  }

  const [member] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, channel.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  // Upsert voice_state — userId UNIQUE (1 user chỉ active 1 voice cùng lúc).
  // selfMuted=true: vào phòng mic TẮT (mode mặc định 'voice') → tránh nhấp nháy
  // "mic on" ở sidebar người khác; VoiceStateSync sẽ chỉnh lại nếu user bật mic.
  await db
    .insert(studyGroupVoiceState)
    .values({ userId: session.user.id, channelId, selfMuted: true })
    .onConflictDoUpdate({
      target: studyGroupVoiceState.userId,
      set: {
        channelId,
        joinedAt: new Date(),
        selfMuted: true,
        serverMuted: false,
        camera: false,
        screenShare: false,
      },
    });

  // Gửi ĐỦ data participant trong payload → client merge thẳng vào list, KHỎI
  // refetch thêm 1 vòng HTTP (giảm trễ khi người vô voice). Webhook prod thiếu
  // image nên vẫn gửi tối thiểu → client tự fallback refetch ở nhánh else.
  void triggerEvent(`presence-voice-${channelId}`, 'voice:join', {
    userId: session.user.id,
    name: session.user.name ?? '',
    image: session.user.image ?? null,
    selfMuted: true,
    serverMuted: false,
    camera: false,
    screenShare: false,
    joinedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
