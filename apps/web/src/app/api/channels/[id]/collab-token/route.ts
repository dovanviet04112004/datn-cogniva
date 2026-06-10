/**
 * POST /api/channels/[id]/collab-token — issue Hocuspocus JWT cho voice channel
 * trong study group.
 *
 * Mirror /api/rooms/[id]/collab-token nhưng check membership qua
 * study_group_member thay vì room_member. JWT payload dùng cùng format
 * { userId, roomId, kind } — Hocuspocus không phân biệt rooms vs channels,
 * chỉ check token.roomId === documentName.roomId. Truyền channelId vào
 * field `roomId` của JWT.
 *
 * Body: { kind: 'whiteboard' | 'notes' | 'code' }
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { db, studyGroupChannel, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const BODY_SCHEMA = z.object({
  kind: z.enum(['whiteboard', 'notes', 'code']),
});

export async function POST(req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: channelId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Channel + group membership check
  const [channel] = await db
    .select({ id: studyGroupChannel.id, groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!channel) return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });

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
  if (!member) return NextResponse.json({ error: 'Not a group member' }, { status: 403 });

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'JWT_SECRET not configured' }, { status: 500 });
  }
  if (secret.length < 32) {
    return NextResponse.json({ error: 'JWT_SECRET too short (need 32+)' }, { status: 500 });
  }

  const url = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
  if (!url) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_HOCUSPOCUS_URL not set' }, { status: 500 });
  }

  // Sign — dùng channelId làm "roomId" để Hocuspocus parser match.
  // Doc name client truyền: `room:{channelId}:{kind}`.
  const token = jwt.sign(
    { userId: session.user.id, roomId: channelId, kind: parsed.data.kind },
    secret,
    { expiresIn: '15m' },
  );

  return NextResponse.json({ token, url });
}
