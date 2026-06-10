/**
 * GET /api/admin/groups/[id]/recordings — list voice recordings của 1 group.
 *
 * Recording → studyGroupChannel → studyGroup (qua channelId). Trả về kèm
 * channel name + recorder info.
 *
 * Auth: requireAdminRole — mọi role có thể xem (read-only).
 */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';

import { db, recording, studyGroupChannel, user } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;

  // Join recording → studyGroupChannel WHERE channel.groupId = id
  const rows = await db
    .select({
      id: recording.id,
      channelId: recording.studyGroupChannelId,
      channelName: studyGroupChannel.name,
      createdBy: recording.createdBy,
      recorderName: user.name,
      recorderEmail: user.email,
      storageKey: recording.storageKey,
      fileUrl: recording.fileUrl,
      duration: recording.duration,
      fileSize: recording.fileSize,
      status: recording.status,
      startedAt: recording.startedAt,
      endedAt: recording.endedAt,
    })
    .from(recording)
    .innerJoin(
      studyGroupChannel,
      eq(studyGroupChannel.id, recording.studyGroupChannelId),
    )
    .leftJoin(user, eq(user.id, recording.createdBy))
    .where(eq(studyGroupChannel.groupId, id))
    .orderBy(desc(recording.startedAt))
    .limit(100);

  return NextResponse.json({
    recordings: rows.map((r) => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
    })),
  });
}
