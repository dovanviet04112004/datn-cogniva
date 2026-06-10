/**
 * /api/groups/[id]/channels — list + create channel trong group.
 *
 * GET: trả mọi channel sorted by position (chỉ member group mới gọi được).
 * POST { name, type, topic?, voiceMaxParticipants? }:
 *   - ADMIN+ mới được tạo
 *   - VOICE channel: tự sinh livekitRoomName = `group:{channelId}` sau khi insert
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

// `db` cho write (POST) + auth-check membership cần strong consistency;
// `dbReplica` cho read thuần GET (scan channels) để giảm tải primary.
import { db, dbReplica, studyGroupChannel, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onGroupChanged } from '@/lib/cache/invalidate';
import { can, type GroupRole } from '@/lib/group/permissions';

export const runtime = 'nodejs';

const CREATE_SCHEMA = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    // Slug-style: lowercase + chỉ chữ/số/dấu gạch (cho phép unicode tiếng Việt)
    .regex(/^[\p{L}0-9\-_]+$/u, 'Tên chỉ cho phép chữ, số, gạch ngang, gạch dưới'),
  type: z.enum(['TEXT', 'VOICE', 'ANNOUNCEMENT', 'STAGE', 'FORUM']),
  topic: z.string().max(200).optional(),
  voiceMaxParticipants: z.number().int().min(1).max(100).optional(),
});

/** Load membership của user trong group, return null nếu không phải member. */
async function getMembership(groupId: string, userId: string) {
  const [m] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, groupId), eq(studyGroupMember.userId, userId)),
    )
    .limit(1);
  return m ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  // Read thuần list channels → đọc qua replica (không read-your-own-write)
  const channels = await dbReplica
    .select()
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.groupId, groupId))
    .orderBy(asc(studyGroupChannel.position), asc(studyGroupChannel.createdAt));

  return NextResponse.json({ channels });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (!can(me.role as GroupRole, 'channel.create')) {
    return NextResponse.json({ error: 'Không có quyền tạo channel' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Lấy max position hiện có để append cuối
  const existing = await db
    .select({ pos: studyGroupChannel.position })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.groupId, groupId))
    .orderBy(asc(studyGroupChannel.position));
  const last = existing[existing.length - 1];
  const nextPos = last ? (last.pos ?? 0) + 1 : 0;

  const [created] = await db
    .insert(studyGroupChannel)
    .values({
      groupId,
      name: parsed.data.name,
      type: parsed.data.type,
      topic: parsed.data.topic ?? null,
      position: nextPos,
      createdBy: session.user.id,
      voiceMaxParticipants:
        parsed.data.type === 'VOICE' || parsed.data.type === 'STAGE'
          ? parsed.data.voiceMaxParticipants ?? null
          : null,
    })
    .returning();

  if (!created) {
    return NextResponse.json({ error: 'Tạo channel thất bại' }, { status: 500 });
  }

  // Channel mới → channels nằm trong groupDetail cache → bust để member khác thấy ngay.
  await onGroupChanged(groupId);

  // VOICE + STAGE channel: gán livekitRoomName sau khi có id
  if (created.type === 'VOICE' || created.type === 'STAGE') {
    const livekitRoomName = `group:${created.id}`;
    const [updated] = await db
      .update(studyGroupChannel)
      .set({ livekitRoomName })
      .where(eq(studyGroupChannel.id, created.id))
      .returning();
    return NextResponse.json({ channel: updated }, { status: 201 });
  }

  return NextResponse.json({ channel: created }, { status: 201 });
}
