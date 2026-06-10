/**
 * POST /api/channels/[id]/voice/leave — manually clear voice state.
 *
 * Trường hợp: LiveKit webhook chậm hoặc client disconnect đột ngột,
 * user muốn force-clear state để không bị "ghost" trong participant list.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, studyGroupVoiceState } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await db
    .delete(studyGroupVoiceState)
    .where(
      and(
        eq(studyGroupVoiceState.userId, session.user.id),
        eq(studyGroupVoiceState.channelId, channelId),
      ),
    );

  void triggerEvent(`presence-voice-${channelId}`, 'voice:leave', {
    userId: session.user.id,
  });

  return NextResponse.json({ ok: true });
}
