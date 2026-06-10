/**
 * POST /api/groups/[id]/ping — update lastSeenAt = now.
 *
 * Client gọi mỗi 60s khi tab active. Dùng để render online dot ở member sidebar.
 * Fallback: presence realtime giờ chạy qua Socket.IO presence channel (apps/realtime); ping vẫn giữ làm dự phòng.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await db
    .update(studyGroupMember)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    );

  return NextResponse.json({ ok: true });
}
