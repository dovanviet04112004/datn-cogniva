/**
 * POST /api/groups/[id]/channels/[channelId]/typing — broadcast typing event.
 *
 * Spec V2 Quick Win 3: typing indicator (docs/plans/study-group-v2.md).
 *
 * Client (message-composer) debounce 1s gọi endpoint khi user đang gõ. Server
 * verify session + group membership rồi `triggerEvent` realtime `private-channel-{channelId}`
 * → các member khác trong channel render "X đang gõ…" footer.
 *
 * Không lưu DB — ephemeral. Client tự expire khi không có event mới ~5s.
 *
 * Rate limit: client debounce 1s đã đủ; server không re-throttle (client handle).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, studyGroupChannel, studyGroupMember, user } from '@cogniva/db';
import { auth } from '@/lib/auth';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string; channelId: string }> };

export async function POST(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: groupId, channelId } = await ctx.params;

  // Verify membership + channel thuộc group (chống cross-group spoof)
  const [member] = await db
    .select({ userId: studyGroupMember.userId })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [channel] = await db
    .select({ id: studyGroupChannel.id })
    .from(studyGroupChannel)
    .where(
      and(
        eq(studyGroupChannel.id, channelId),
        eq(studyGroupChannel.groupId, groupId),
      ),
    )
    .limit(1);
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  // Lookup display name (cache: V2 sẽ wire context — V1 query trực tiếp)
  const [u] = await db
    .select({ name: user.name, image: user.image })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  await triggerEvent(`private-channel-${channelId}`, 'user:typing', {
    userId: session.user.id,
    name: u?.name ?? 'Ai đó',
    image: u?.image ?? null,
    /** Client expire local sau 5s nếu không có event mới. */
    expiresAt: Date.now() + 5_000,
  });

  return NextResponse.json({ ok: true });
}
