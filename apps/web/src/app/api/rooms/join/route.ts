/**
 * POST /api/rooms/join — join room qua 6-char code.
 *
 * Body: { code: string }
 * Trả: { roomId } để client redirect /rooms/{id}/lobby.
 *
 * Logic:
 *   - Lookup room by joinCode.
 *   - Auto-insert membership ACTIVE nếu chưa có (UNLISTED/PUBLIC code-based).
 *   - PRIVATE room: code chỉ mod biết, ai có code là valid → ACTIVE.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, room, roomMember } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const BODY_SCHEMA = z.object({
  code: z.string().min(4).max(20),
});

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const [target] = await db
    .select()
    .from(room)
    .where(eq(room.joinCode, parsed.data.code.toUpperCase()))
    .limit(1);
  if (!target) return NextResponse.json({ error: 'Mã không hợp lệ' }, { status: 404 });

  const uid = session.user.id;
  const [existing] = await db
    .select()
    .from(roomMember)
    .where(and(eq(roomMember.roomId, target.id), eq(roomMember.userId, uid)))
    .limit(1);

  if (existing?.status === 'BANNED' || existing?.status === 'KICKED') {
    return NextResponse.json({ error: 'Bạn không thể vào phòng này' }, { status: 403 });
  }

  // Insert membership nếu chưa có
  if (!existing) {
    await db.insert(roomMember).values({
      roomId: target.id,
      userId: uid,
      role: target.ownerId === uid ? 'OWNER' : 'MEMBER',
      status: 'ACTIVE',
    });
  } else if (existing.status !== 'ACTIVE') {
    // PENDING → activate (Phase 13.8 sẽ check requireApproval)
    await db
      .update(roomMember)
      .set({ status: 'ACTIVE' })
      .where(and(eq(roomMember.roomId, target.id), eq(roomMember.userId, uid)));
  }

  return NextResponse.json({ roomId: target.id });
}
