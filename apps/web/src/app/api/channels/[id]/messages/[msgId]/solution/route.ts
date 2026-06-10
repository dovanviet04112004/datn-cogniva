/**
 * POST /api/channels/[id]/messages/[msgId]/solution — V2 G5.4 (2026-05-21).
 *
 * Đánh dấu / bỏ đánh dấu 1 reply trong forum thread là solution.
 *
 * Body: { mark: boolean }
 *   - true  : set is_solution=true cho reply NÀY + clear flag mọi reply
 *             khác cùng thread (chỉ 1 solution/thread, Discord pattern)
 *   - false : clear flag chỉ reply này
 *
 * Auth: post author (root message author) HOẶC mod+ (`message.delete-any`).
 *
 * Validate:
 *   - Channel phải là FORUM
 *   - Message phải là reply (có thread_root_id)
 *   - User là member group
 *
 * Broadcast realtime event 'forum:solution' để client list/thread refresh.
 *
 * Spec: docs/plans/study-group-v2.md §G5.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupMessage,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, type GroupRole } from '@/lib/group/permissions';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

const BODY_SCHEMA = z.object({
  mark: z.boolean(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const { id: channelId, msgId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Load message + channel + member context
  const [msg] = await db
    .select()
    .from(studyGroupMessage)
    .where(and(eq(studyGroupMessage.id, msgId), eq(studyGroupMessage.channelId, channelId)))
    .limit(1);
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (!msg.threadRootId) {
    return NextResponse.json(
      { error: 'Chỉ reply trong thread mới đánh dấu solution được' },
      { status: 400 },
    );
  }

  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId, type: studyGroupChannel.type })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  if (ch.type !== 'FORUM') {
    return NextResponse.json({ error: 'Channel không phải FORUM' }, { status: 400 });
  }

  const [member] = await db
    .select({ id: studyGroupMember.id, role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Load root post để check quyền author
  const [rootPost] = await db
    .select({ authorId: studyGroupMessage.authorId })
    .from(studyGroupMessage)
    .where(eq(studyGroupMessage.id, msg.threadRootId))
    .limit(1);
  if (!rootPost) {
    return NextResponse.json({ error: 'Thread root not found' }, { status: 404 });
  }

  const isPostAuthor = rootPost.authorId === session.user.id;
  const isMod = can(member.role as GroupRole, 'message.delete-any');
  if (!isPostAuthor && !isMod) {
    return NextResponse.json(
      { error: 'Chỉ tác giả post hoặc mod mới đánh dấu solution' },
      { status: 403 },
    );
  }

  if (parsed.data.mark) {
    // Atomic: clear flag mọi reply khác cùng thread + set flag reply này
    await db.transaction(async (tx) => {
      await tx
        .update(studyGroupMessage)
        .set({ isSolution: false })
        .where(
          and(
            eq(studyGroupMessage.threadRootId, msg.threadRootId!),
            ne(studyGroupMessage.id, msgId),
          ),
        );
      await tx
        .update(studyGroupMessage)
        .set({ isSolution: true })
        .where(eq(studyGroupMessage.id, msgId));
    });
  } else {
    await db
      .update(studyGroupMessage)
      .set({ isSolution: false })
      .where(eq(studyGroupMessage.id, msgId));
  }

  // Broadcast — listen ở ForumChannel list + ThreadPanel để refetch
  void triggerEvent(`private-channel-${channelId}`, 'forum:solution', {
    messageId: msgId,
    threadRootId: msg.threadRootId,
    isSolution: parsed.data.mark,
    by: session.user.id,
  });

  return NextResponse.json({ ok: true, isSolution: parsed.data.mark });
}
