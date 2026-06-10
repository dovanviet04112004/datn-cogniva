/**
 * POST /api/channels/[id]/messages/[msgId]/react — toggle reaction.
 *
 * Body: { emoji: string }
 *
 * Reactions stored as `{ '👍': [uid1, uid2], '❤️': [uid3] }` (JSONB).
 * Toggle = nếu user đã có trong array → remove; chưa có → append.
 * Limit: max 20 emoji distinct per message (Discord parity).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupMessage,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, isMuted, type GroupRole } from '@/lib/group/permissions';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  // Emoji string — không validate chính xác emoji, accept any short string
  emoji: z.string().min(1).max(16),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const { id: channelId, msgId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify membership
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });

  const [member] = await db
    .select()
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!can(member.role as GroupRole, 'message.react')) {
    return NextResponse.json({ error: 'Không có quyền react' }, { status: 403 });
  }
  if (isMuted(member)) {
    return NextResponse.json({ error: 'Bạn đang bị mute' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const emoji = parsed.data.emoji;
  const uid = session.user.id;

  // Load message current reactions
  const [msg] = await db
    .select({ reactions: studyGroupMessage.reactions })
    .from(studyGroupMessage)
    .where(and(eq(studyGroupMessage.id, msgId), eq(studyGroupMessage.channelId, channelId)))
    .limit(1);
  if (!msg) return NextResponse.json({ error: 'Message không tồn tại' }, { status: 404 });

  const current: Record<string, string[]> = (msg.reactions as Record<string, string[]> | null) ?? {};
  const list = current[emoji] ?? [];
  const idx = list.indexOf(uid);

  if (idx >= 0) {
    list.splice(idx, 1);
    if (list.length === 0) delete current[emoji];
    else current[emoji] = list;
  } else {
    if (!current[emoji] && Object.keys(current).length >= 20) {
      return NextResponse.json({ error: 'Đã đạt 20 emoji distinct' }, { status: 400 });
    }
    current[emoji] = [...list, uid];
  }

  await db
    .update(studyGroupMessage)
    .set({ reactions: current })
    .where(eq(studyGroupMessage.id, msgId));

  void triggerEvent(`private-channel-${channelId}`, 'message:react', {
    id: msgId,
    reactions: current,
  });

  return NextResponse.json({ reactions: current });
}
