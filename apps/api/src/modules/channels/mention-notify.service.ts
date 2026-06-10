/**
 * MentionNotifyService — gửi notification + Expo push tới user được @mention.
 * Port NGUYÊN semantics từ apps/web/src/lib/group/mention-notify.ts (web lib
 * GIỮ NGUYÊN tới cutover — đồng bộ tay nếu web đổi).
 *
 * Flow: validate userIds thuộc group (anti-spam) → skip user đã set
 * notification_setting='none' cho channel → NotificationsService.notifyWithPush
 * (log status 'pending'/'no-token' theo token + realtime ping + Expo batch 100).
 * Nội dung push NGẮN HƠN bản log + data KHÔNG có authorId — y mention-notify cũ.
 *
 * Fire-and-forget: mọi lỗi nuốt trong try/catch (logger.error), caller `void`.
 */
import { Injectable } from '@nestjs/common';
import { logger } from '@cogniva/server-core';

import { PrismaService } from '../../infra/database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const NOTIF_TYPE = 'group-mention';

export type Mention = { type: 'user' | 'channel' | 'everyone'; id: string };

@Injectable()
export class MentionNotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async fireMentionEvents(opts: {
    groupId: string;
    channelId: string;
    channelName: string;
    messageId: string;
    authorId: string;
    authorName: string;
    mentions: Mention[];
    content: string;
  }): Promise<void> {
    // Filter chỉ user mention, loại self-mention
    const userIds = Array.from(
      new Set(
        opts.mentions
          .filter((m) => m.type === 'user' && m.id !== opts.authorId)
          .map((m) => m.id),
      ),
    );
    if (userIds.length === 0) return;

    try {
      // Validate: phải là member của group (anti-spam mention ngoài group)
      const validMembers = await this.prisma.study_group_member.findMany({
        where: { group_id: opts.groupId, user_id: { in: userIds } },
        select: { user_id: true },
      });
      let validIds = validMembers.map((m) => m.user_id);
      if (validIds.length === 0) return;

      // V2 G4: filter out user đã set notification_setting='none' cho channel này.
      // 'mentions' và 'all' đều cho push mention; 'none' = tắt hoàn toàn.
      const mutedRows = await this.prisma.study_group_read_state.findMany({
        where: {
          channel_id: opts.channelId,
          user_id: { in: validIds },
          notification_setting: 'none',
        },
        select: { user_id: true },
      });
      const mutedSet = new Set(mutedRows.map((r) => r.user_id));
      validIds = validIds.filter((id) => !mutedSet.has(id));
      if (validIds.length === 0) return;

      const preview =
        opts.content.length > 100 ? opts.content.slice(0, 100) + '...' : opts.content;

      await this.notifications.notifyWithPush(
        validIds.map((uid) => ({
          userId: uid,
          type: NOTIF_TYPE,
          title: `${opts.authorName} đã mention bạn trong #${opts.channelName}`,
          body: preview,
          data: {
            type: NOTIF_TYPE,
            groupId: opts.groupId,
            channelId: opts.channelId,
            messageId: opts.messageId,
            authorId: opts.authorId,
          },
        })),
        {
          title: `${opts.authorName} đã mention bạn`,
          body: `#${opts.channelName}: ${preview}`,
          data: {
            type: NOTIF_TYPE,
            groupId: opts.groupId,
            channelId: opts.channelId,
            messageId: opts.messageId,
          },
        },
      );
    } catch (err) {
      logger.error('group-mention.fire-failed', {
        error: err instanceof Error ? err.message : String(err),
        groupId: opts.groupId,
        channelId: opts.channelId,
      });
    }
  }
}

/**
 * Parse @username từ content — extract pattern `@[name](userId)` client gen khi
 * pick autocomplete + detect @everyone. Copy verbatim từ mention-notify.ts.
 */
export function parseMentions(content: string): Mention[] {
  const out: Mention[] = [];
  const seen = new Set<string>();
  const re = /@\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ type: 'user', id });
  }
  // @everyone / @here — chỉ ADMIN+ post mới ý nghĩa, V1 detect đơn giản
  if (/(^|\s)@everyone(\s|$)/.test(content)) out.push({ type: 'everyone', id: 'everyone' });
  return out;
}
