/**
 * GET  /api/channels/[id]/stage — state hiện tại: speakers + raised hands.
 * POST /api/channels/[id]/stage — audience raise/lower hand.
 *
 * State trả về:
 *   - mySelf: { role: 'AUDIENCE'|'SPEAKER'|'MOD', raised: bool }
 *   - speakers: [{ userId, name, image }] (role=SPEAKER + members là MOD+)
 *   - raisedHands: [{ userId, name, image, raisedAt }] (audience đã raise)
 *
 * Body POST: { action: 'raise' | 'lower' }
 *   - raise: chỉ AUDIENCE mới raise được (MOD/SPEAKER không cần)
 *   - lower: clear raisedAt
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupStageRole,
  user,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

async function loadCtx(channelId: string, userId: string) {
  const [ch] = await db
    .select()
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch || ch.type !== 'STAGE') return null;
  const [member] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, userId),
      ),
    )
    .limit(1);
  if (!member) return null;
  return { channel: ch, member };
}

export async function GET(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: channelId } = await params;
  const ctx = await loadCtx(channelId, session.user.id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Speakers: stage_role.role='SPEAKER' UNION với members role MOD+
  const speakers = await db
    .select({
      userId: studyGroupStageRole.userId,
      name: user.name,
      image: user.image,
      promotedAt: studyGroupStageRole.promotedAt,
    })
    .from(studyGroupStageRole)
    .innerJoin(user, eq(user.id, studyGroupStageRole.userId))
    .where(
      and(
        eq(studyGroupStageRole.channelId, channelId),
        eq(studyGroupStageRole.role, 'SPEAKER'),
      ),
    );

  // Raised hands: audience role + raisedAt NOT NULL
  const raised = await db
    .select({
      userId: studyGroupStageRole.userId,
      name: user.name,
      image: user.image,
      raisedAt: studyGroupStageRole.raisedAt,
    })
    .from(studyGroupStageRole)
    .innerJoin(user, eq(user.id, studyGroupStageRole.userId))
    .where(
      and(
        eq(studyGroupStageRole.channelId, channelId),
        eq(studyGroupStageRole.role, 'AUDIENCE'),
        isNotNull(studyGroupStageRole.raisedAt),
      ),
    )
    .orderBy(asc(studyGroupStageRole.raisedAt));

  // My role
  const isMod = ['OWNER', 'ADMIN', 'MODERATOR'].includes(ctx.member.role);
  const [mine] = await db
    .select({ role: studyGroupStageRole.role, raisedAt: studyGroupStageRole.raisedAt })
    .from(studyGroupStageRole)
    .where(
      and(
        eq(studyGroupStageRole.channelId, channelId),
        eq(studyGroupStageRole.userId, session.user.id),
      ),
    )
    .limit(1);

  return NextResponse.json({
    mySelf: {
      role: isMod ? 'MOD' : (mine?.role ?? 'AUDIENCE'),
      raised: !!mine?.raisedAt,
    },
    speakers: speakers.map((s) => ({ ...s, promotedAt: s.promotedAt?.toISOString() ?? null })),
    raisedHands: raised.map((r) => ({ ...r, raisedAt: r.raisedAt?.toISOString() ?? '' })),
    isMod,
  });
}

const POST_SCHEMA = z.object({ action: z.enum(['raise', 'lower']) });

export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: channelId } = await params;
  const ctx = await loadCtx(channelId, session.user.id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // MOD không cần raise hand — đã được publish sẵn.
  const isMod = ['OWNER', 'ADMIN', 'MODERATOR'].includes(ctx.member.role);
  if (isMod) {
    return NextResponse.json({ error: 'Mod không cần raise hand' }, { status: 400 });
  }

  const raisedAt = parsed.data.action === 'raise' ? new Date() : null;
  await db
    .insert(studyGroupStageRole)
    .values({
      channelId,
      userId: session.user.id,
      role: 'AUDIENCE',
      raisedAt,
    })
    .onConflictDoUpdate({
      target: [studyGroupStageRole.userId, studyGroupStageRole.channelId],
      set: { raisedAt },
    });

  // Broadcast realtime — mod thấy ngay
  await triggerEvent(`presence-voice-${channelId}`, 'stage:hand', {
    userId: session.user.id,
    userName: ctx.member ? session.user.name : null,
    raised: parsed.data.action === 'raise',
  });

  return NextResponse.json({ ok: true, raised: parsed.data.action === 'raise' });
}
