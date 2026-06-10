/**
 * GET / PUT /api/channels/[id]/notification-setting — V2 G4.1 (2026-05-21).
 *
 * Spec: docs/plans/study-group-v2.md §G4.
 *
 * Per-channel notification preference (Discord-style):
 *   - 'all'      → push tất cả message
 *   - 'mentions' → chỉ push khi @mention user
 *   - 'none'     → tắt push hoàn toàn (vẫn ghi notification_log)
 *
 * Auth: member của group chứa channel. PUT upsert vào study_group_read_state.
 *
 * Backward-compat: cũng update cột `muted` (true nếu setting='none').
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

const PUT_SCHEMA = z.object({
  setting: z.enum(['all', 'mentions', 'none']),
});

async function verifyMember(channelId: string, userId: string) {
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return null;
  const [m] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, userId),
      ),
    )
    .limit(1);
  return m ? { groupId: ch.groupId, memberId: m.id } : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await verifyMember(channelId, session.user.id);
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [row] = await db
    .select({
      setting: studyGroupReadState.notificationSetting,
      muted: studyGroupReadState.muted,
    })
    .from(studyGroupReadState)
    .where(
      and(
        eq(studyGroupReadState.userId, session.user.id),
        eq(studyGroupReadState.channelId, channelId),
      ),
    )
    .limit(1);

  return NextResponse.json({
    setting: row?.setting ?? 'all',
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await verifyMember(channelId, session.user.id);
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = PUT_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const muted = parsed.data.setting === 'none';

  // Upsert (user, channel)
  await db
    .insert(studyGroupReadState)
    .values({
      userId: session.user.id,
      channelId,
      notificationSetting: parsed.data.setting,
      muted,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [studyGroupReadState.userId, studyGroupReadState.channelId],
      set: {
        notificationSetting: parsed.data.setting,
        muted,
        updatedAt: sql`now()`,
      },
    });

  // `muted` đổi → unread query lọc theo rs.muted (channel muted không tính unread).
  // Bust ck.groupUnread(groupId, userId) để badge phản ánh ngay. ok.groupId từ guard.
  await onGroupReadChanged(ok.groupId, session.user.id);

  return NextResponse.json({ setting: parsed.data.setting });
}
