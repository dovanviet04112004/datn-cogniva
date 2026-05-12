/**
 * POST /api/rooms/[id]/collab-token — issue JWT cho Hocuspocus connection.
 *
 * Body: { kind: 'whiteboard' | 'notes' | 'code' }
 * Trả: { token, url } — token signed bằng JWT_SECRET (shared với Hocuspocus).
 *
 * TTL ngắn (15 phút) — client tự refresh khi expire. Hocuspocus reject
 * connection nếu signature sai hoặc kind/roomId mismatch.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { db, roomMember } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const BODY_SCHEMA = z.object({
  kind: z.enum(['whiteboard', 'notes', 'code']),
});

export async function POST(req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: roomId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  // Verify membership ACTIVE
  const [member] = await db
    .select()
    .from(roomMember)
    .where(
      and(
        eq(roomMember.roomId, roomId),
        eq(roomMember.userId, session.user.id),
        eq(roomMember.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

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

  // Sign — payload format match Hocuspocus onAuthenticate
  const token = jwt.sign(
    { userId: session.user.id, roomId, kind: parsed.data.kind },
    secret,
    { expiresIn: '15m' },
  );

  return NextResponse.json({ token, url });
}
