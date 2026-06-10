/**
 * POST /api/channels/[id]/voice/state — sync mic/cam/screen state cho user
 * hiện tại.
 *
 * Mục đích: webhook LiveKit chỉ fire khi public URL set; local dev dùng
 * endpoint này từ client mỗi khi user toggle mic/cam/screen → cập nhật DB
 * + emit realtime `voice:state-changed` → inline list refresh tức thì.
 *
 * Body partial — chỉ field nào gửi mới update (PATCH-like):
 *   { selfMuted?, camera?, screenShare? }
 *
 * UPSERT: nếu row chưa tồn tại (race với /voice/join), tạo mới với delta
 * + default field còn lại. Tránh 404 khi VoiceStateSync mount nhanh hơn
 * /voice/join hoàn thành.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db, studyGroupVoiceState } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  selfMuted: z.boolean().optional(),
  camera: z.boolean().optional(),
  screenShare: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  // UPSERT — chấp nhận race với /voice/join. Trên INSERT mới, default những
  // field không có trong delta. Trên CONFLICT (đã join trước), chỉ UPDATE
  // field có trong delta + channelId (phòng user move qua channel khác).
  const updateSet: Record<string, unknown> = { channelId };
  if (parsed.data.selfMuted !== undefined) updateSet.selfMuted = parsed.data.selfMuted;
  if (parsed.data.camera !== undefined) updateSet.camera = parsed.data.camera;
  if (parsed.data.screenShare !== undefined) updateSet.screenShare = parsed.data.screenShare;

  await db
    .insert(studyGroupVoiceState)
    .values({
      userId: session.user.id,
      channelId,
      selfMuted: parsed.data.selfMuted ?? false,
      camera: parsed.data.camera ?? false,
      screenShare: parsed.data.screenShare ?? false,
    })
    .onConflictDoUpdate({
      target: studyGroupVoiceState.userId,
      set: updateSet,
    });

  // Broadcast — payload chỉ field thay đổi để client merge
  void triggerEvent(`presence-voice-${channelId}`, 'voice:state-changed', {
    userId: session.user.id,
    ...parsed.data,
  });

  return NextResponse.json({ ok: true });
}
