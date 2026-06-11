import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma.service';

function isThreadMember(thread: { user1_id: string; user2_id: string }, uid: string): boolean {
  return thread.user1_id === uid || thread.user2_id === uid;
}

@Injectable()
export class RealtimeService {
  constructor(private readonly prisma: PrismaService) {}

  private async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.study_group_member.findFirst({
      where: { group_id: groupId, user_id: userId },
      select: { id: true },
    });
    return !!m;
  }

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
      return res.ok && (res.type === 'VOICE' || res.type === 'STAGE');
    }
    if (channel.startsWith('private-dm-')) {
      const threadId = channel.replace('private-dm-', '');
      const t = await this.prisma.dm_thread.findUnique({ where: { id: threadId } });
      return !!t && isThreadMember(t, uid);
    }
    return false;
  }
}
