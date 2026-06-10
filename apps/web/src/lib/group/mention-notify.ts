/**
 * Mention notification — gửi Expo push tới user được @mention trong message.
 *
 * Flow:
 *   1. POST /messages → server lưu mention array vào DB + gọi `fireMentionEvents()`
 *      fire-and-forget (không block response).
 *   2. Helper này:
 *      - Validate userIds trong mentions thuộc group (chống spam mention user ngoài)
 *      - Skip mention chính tác giả (tránh self-notify)
 *      - Look up push_token enabled cho mỗi user → Expo batch push
 *      - Insert notification_log row mỗi user
 *
 * V2 sẽ chuyển sang BullMQ job `msg/mentioned` với retry + rate-limit
 * (plan §8.7.2). V1 inline để đơn giản, accept loss khi server crash giữa fire.
 *
 * @everyone / @here — V1 chỉ accept type='user', 2 type kia hiện chưa wire push.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import {
  db,
  notificationLog,
  pushToken,
  studyGroupMember,
  studyGroupReadState,
} from '@cogniva/db';

import { logger } from '@/lib/observability/logger';
import { triggerEvent } from '@/lib/realtime-server';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const NOTIF_TYPE = 'group-mention';
const EXPO_BATCH_SIZE = 100;

type Mention = { type: 'user' | 'channel' | 'everyone'; id: string };

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
  channelId: string;
}

export async function fireMentionEvents(opts: {
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
    const validMembers = await db
      .select({ userId: studyGroupMember.userId })
      .from(studyGroupMember)
      .where(
        and(
          eq(studyGroupMember.groupId, opts.groupId),
          inArray(studyGroupMember.userId, userIds),
        ),
      );
    let validIds = validMembers.map((m) => m.userId);
    if (validIds.length === 0) return;

    // V2 G4: filter out user đã set notification_setting='none' cho channel này.
    // 'mentions' và 'all' đều cho push mention; 'none' = tắt hoàn toàn.
    const mutedRows = await db
      .select({ userId: studyGroupReadState.userId })
      .from(studyGroupReadState)
      .where(
        and(
          eq(studyGroupReadState.channelId, opts.channelId),
          inArray(studyGroupReadState.userId, validIds),
          eq(studyGroupReadState.notificationSetting, 'none'),
        ),
      );
    const mutedSet = new Set(mutedRows.map((r) => r.userId));
    validIds = validIds.filter((id) => !mutedSet.has(id));
    if (validIds.length === 0) return;

    // Tokens
    const tokens = await db
      .select({ userId: pushToken.userId, token: pushToken.token })
      .from(pushToken)
      .where(
        and(
          inArray(pushToken.userId, validIds),
          eq(pushToken.enabled, true),
          isNotNull(pushToken.token),
        ),
      );

    const preview = opts.content.length > 100 ? opts.content.slice(0, 100) + '...' : opts.content;

    // Insert notification_log cho mọi user (kể cả không có token → in-app notif V2)
    const logRows = validIds.map((uid) => ({
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
      status: tokens.some((t) => t.userId === uid) ? 'pending' : 'no-token',
      receiptId: null,
      error: null,
      sentAt: null,
    }));
    if (logRows.length > 0) {
      await db.insert(notificationLog).values(logRows);
      // Bắn realtime để chuông người được mention cập nhật NGAY (không đợi poll).
      await Promise.all(
        validIds.map((uid) =>
          triggerEvent(`presence-user-${uid}`, 'notification:new', {}).catch(() => {}),
        ),
      );
    }

    if (tokens.length === 0) return;

    // Batch Expo push
    const messages: ExpoMessage[] = tokens.map((t) => ({
      to: t.token,
      title: `${opts.authorName} đã mention bạn`,
      body: `#${opts.channelName}: ${preview}`,
      data: {
        type: NOTIF_TYPE,
        groupId: opts.groupId,
        channelId: opts.channelId,
        messageId: opts.messageId,
      },
      sound: 'default',
      priority: 'high',
      channelId: 'default',
    }));

    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      try {
        const res = await fetch(EXPO_PUSH_API_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(batch),
        });
        if (!res.ok) {
          logger.warn('group-mention.expo-batch-failed', {
            status: res.status,
            batch_size: batch.length,
          });
        }
      } catch (err) {
        logger.warn('group-mention.expo-fetch-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error('group-mention.fire-failed', {
      error: err instanceof Error ? err.message : String(err),
      groupId: opts.groupId,
      channelId: opts.channelId,
    });
  }
}

/**
 * Parse @username từ content text — V1 chỉ extract pattern `@[name](userId)`
 * dạng markdown link client gen ra khi user pick từ autocomplete.
 *
 * Format syntax: `@[DO VAN VIET](userId123)` → { type: 'user', id: 'userId123' }
 * Client trong message-composer dùng pattern này khi pick từ dropdown.
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
