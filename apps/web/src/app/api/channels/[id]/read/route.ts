/**
 * GET  /api/channels/[id]/read — trả lastReadMessageId hiện tại của user.
 * POST /api/channels/[id]/read — đánh dấu đã đọc tới message X.
 *
 * GET dùng cho unread divider (V2 quick win 5): client snapshot tại mount,
 * render line "X tin mới" trên message đầu tiên sau snapshot này. Sau khi
 * client POST cập nhật → snapshot vẫn không đổi cho session hiện tại.
 *
 * POST body: { lastMessageId: string } → upsert study_group_read_state.
 *
 * Unread badge count:
 *   count messages WHERE channel_id = X AND created_at > (lastReadMessageId).createdAt
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupReadState,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onGroupReadChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  lastMessageId: z.string().min(1),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Reuse member check qua join (1 query thay 2 sequential)
  const [row] = await db
    .select({ lastReadMessageId: studyGroupReadState.lastReadMessageId })
    .from(studyGroupReadState)
    .where(
      and(
        eq(studyGroupReadState.userId, session.user.id),
        eq(studyGroupReadState.channelId, channelId),
      ),
    )
    .limit(1);

  return NextResponse.json({ lastReadMessageId: row?.lastReadMessageId ?? null });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify member
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });

  const [member] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Upsert: insert ON CONFLICT (user, channel) → update lastReadMessageId
  await db
    .insert(studyGroupReadState)
    .values({
      userId: session.user.id,
      channelId,
      lastReadMessageId: parsed.data.lastMessageId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [studyGroupReadState.userId, studyGroupReadState.channelId],
      set: {
        lastReadMessageId: parsed.data.lastMessageId,
        updatedAt: sql`now()`,
      },
    });

  // User vừa mark-read 1 channel → unread badge của họ ở group này đổi (về 0 cho
  // channel đó). Bust ck.groupUnread(groupId, userId) — ch.groupId đã load ở guard.
  await onGroupReadChanged(ch.groupId, session.user.id);

  return NextResponse.json({ ok: true });
}
