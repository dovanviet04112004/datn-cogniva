/**
 * POST /api/channels/[id]/voice/token — gen LiveKit JWT cho VOICE channel.
 *
 * Auto-upgrade `livekitRoomName` nếu channel chưa có (cũ — tạo trước Phase 20).
 * Mod (OWNER/ADMIN/MODERATOR) → grant roomAdmin để kick/mute participant khác.
 *
 * Trả: { token, url, channel: { id, name, livekitRoomName } }
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupStageRole,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, isMuted, type GroupRole } from '@/lib/group/permissions';
import { createLivekitToken } from '@/lib/livekit';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [channel] = await db
    .select()
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!channel) return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });
  if (channel.type !== 'VOICE' && channel.type !== 'STAGE') {
    return NextResponse.json({ error: 'Channel không phải VOICE/STAGE' }, { status: 400 });
  }

  // Verify member group
  const [member] = await db
    .select()
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, channel.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!can(member.role as GroupRole, 'voice.connect')) {
    return NextResponse.json({ error: 'Không có quyền join voice' }, { status: 403 });
  }
  if (isMuted(member)) {
    return NextResponse.json({ error: 'Bạn đang bị mute' }, { status: 403 });
  }

  // Auto-set livekitRoomName nếu chưa có (channel tạo trước migration phase 20)
  let livekitRoomName = channel.livekitRoomName;
  if (!livekitRoomName) {
    livekitRoomName = `group:${channel.id}`;
    await db
      .update(studyGroupChannel)
      .set({ livekitRoomName })
      .where(eq(studyGroupChannel.id, channel.id));
  }

  const isMod = ['OWNER', 'ADMIN', 'MODERATOR'].includes(member.role);
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!url) {
    return NextResponse.json({ error: 'LiveKit chưa cấu hình' }, { status: 500 });
  }

  // STAGE channel: audience không được canPublish. Speaker (set qua bảng
  // study_group_stage_role) hoặc mod thì canPublish=true. Cho lần đầu join,
  // mọi user (trừ mod) bắt đầu role=AUDIENCE.
  let canPublish = true;
  let stageRole: 'AUDIENCE' | 'SPEAKER' | null = null;
  if (channel.type === 'STAGE') {
    if (isMod) {
      // Mod luôn được publish (host)
      canPublish = true;
      stageRole = 'SPEAKER';
    } else {
      // Lookup role hiện tại
      const [existing] = await db
        .select({ role: studyGroupStageRole.role })
        .from(studyGroupStageRole)
        .where(
          and(
            eq(studyGroupStageRole.channelId, channel.id),
            eq(studyGroupStageRole.userId, session.user.id),
          ),
        )
        .limit(1);
      if (!existing) {
        // Lần đầu join → insert AUDIENCE row
        await db
          .insert(studyGroupStageRole)
          .values({ channelId: channel.id, userId: session.user.id, role: 'AUDIENCE' })
          .onConflictDoNothing();
        stageRole = 'AUDIENCE';
        canPublish = false;
      } else {
        stageRole = existing.role as 'AUDIENCE' | 'SPEAKER';
        canPublish = stageRole === 'SPEAKER';
      }
    }
  }

  try {
    const token = await createLivekitToken({
      identity: session.user.id,
      roomName: livekitRoomName,
      name: member.nickname ?? session.user.name ?? 'Unknown',
      isMod,
      canPublish,
      ttl: '4h',
      metadata: {
        groupRole: member.role,
        stageRole,
        avatar: session.user.image ?? null,
      },
    });
    return NextResponse.json({
      token,
      url,
      channel: { id: channel.id, name: channel.name, livekitRoomName, type: channel.type },
      isMod,
      stageRole,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[voice/token] sign fail:', msg);
    return NextResponse.json({ error: 'Token gen thất bại' }, { status: 500 });
  }
}
