/**
 * RealtimeService — authorize membership channel cho Socket.IO gateway.
 * Port từ apps/web/src/app/api/realtime/auth/route.ts (Drizzle → Prisma),
 * luật authorize GIỮ NGUYÊN từ thời Pusher:
 *   - presence-room-{roomId}      : roomMember status ACTIVE
 *   - presence-user-{userId}      : chỉ chính chủ
 *   - presence-group-{groupId}    : member của group
 *   - private-channel-{channelId} : member group chứa channel
 *   - presence-voice-{channelId}  : member group + channel.type ∈ {VOICE, STAGE}
 *   - private-dm-{threadId}       : thành viên thread
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma.service';

/** True nếu uid là 1 trong 2 thành viên của thread. NGUỒN CHUẨN ở apps/web/src/lib/group/dm.ts. */
function isThreadMember(thread: { user1_id: string; user2_id: string }, uid: string): boolean {
  return thread.user1_id === uid || thread.user2_id === uid;
}

@Injectable()
export class RealtimeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Kiểm tra user có là member của group không. */
  private async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.study_group_member.findFirst({
      where: { group_id: groupId, user_id: userId },
      select: { id: true },
    });
    return !!m;
  }

  /** Kiểm tra user có quyền vào channel này không (qua groupId của channel). */
  private async canAccessChannel(
    channelId: string,
    userId: string,
  ): Promise<{ ok: boolean; type?: string }> {
    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true, type: true },
    });
    if (!ch) return { ok: false };
    const member = await this.isGroupMember(ch.group_id, userId);
    return { ok: member, type: ch.type };
  }

  /** Authorize 1 channel — trả true nếu user được vào. */
  async authorize(channel: string, uid: string): Promise<boolean> {
    if (channel.startsWith('presence-room-')) {
      const roomId = channel.replace('presence-room-', '');
      const member = await this.prisma.room_member.findFirst({
        where: { room_id: roomId, user_id: uid, status: 'ACTIVE' },
        select: { id: true },
      });
      return !!member;
    }
    if (channel.startsWith('presence-user-')) {
      return channel.replace('presence-user-', '') === uid;
    }
    if (channel.startsWith('presence-group-')) {
      return this.isGroupMember(channel.replace('presence-group-', ''), uid);
    }
    if (channel.startsWith('private-channel-')) {
      const res = await this.canAccessChannel(channel.replace('private-channel-', ''), uid);
      return res.ok;
    }
    if (channel.startsWith('presence-voice-')) {
      const res = await this.canAccessChannel(channel.replace('presence-voice-', ''), uid);
      // VOICE và STAGE channel đều dùng prefix presence-voice- (cùng LiveKit room).
      return res.ok && (res.type === 'VOICE' || res.type === 'STAGE');
    }
    if (channel.startsWith('private-dm-')) {
      const threadId = channel.replace('private-dm-', '');
      const t = await this.prisma.dm_thread.findUnique({ where: { id: threadId } });
      return !!t && isThreadMember(t, uid);
    }
    return false; // channel không hợp lệ
  }
}
