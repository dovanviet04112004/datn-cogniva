/**
 * /api/rooms — list (GET) + create (POST).
 *
 * GET: trả 3 nhóm room cho user
 *   - mine     : user là owner
 *   - joined   : user là MEMBER hoặc MODERATOR (status ACTIVE), không phải owner
 *   - public   : visibility PUBLIC, không phải member (Phase 14 explore)
 *
 * POST body: { name, description?, type?, visibility?, maxMembers? }
 *   - Tạo room + tự động insert owner làm OWNER member với status ACTIVE.
 *   - Generate joinCode duy nhất.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, room, roomMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { generateJoinCode } from '@/lib/rooms/codes';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid = session.user.id;

  // Mine: user là owner
  const mine = await db
    .select({
      id: room.id,
      name: room.name,
      description: room.description,
      type: room.type,
      visibility: room.visibility,
      status: room.status,
      joinCode: room.joinCode,
      createdAt: room.createdAt,
      memberCount: sql<number>`(SELECT count(*)::int FROM "room_member" WHERE room_id = ${room.id} AND status = 'ACTIVE')`,
    })
    .from(room)
    .where(eq(room.ownerId, uid))
    .orderBy(desc(room.createdAt))
    .limit(50);

  // Joined: là member (không phải owner)
  const joined = await db
    .select({
      id: room.id,
      name: room.name,
      description: room.description,
      type: room.type,
      visibility: room.visibility,
      status: room.status,
      role: roomMember.role,
      createdAt: room.createdAt,
      memberCount: sql<number>`(SELECT count(*)::int FROM "room_member" WHERE room_id = ${room.id} AND status = 'ACTIVE')`,
    })
    .from(roomMember)
    .innerJoin(room, eq(roomMember.roomId, room.id))
    .where(
      and(
        eq(roomMember.userId, uid),
        eq(roomMember.status, 'ACTIVE'),
        ne(room.ownerId, uid),
      ),
    )
    .orderBy(desc(room.createdAt))
    .limit(50);

  return NextResponse.json({ mine, joined });
}

const CREATE_SCHEMA = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['STUDY', 'CLASSROOM', 'EXAM', 'OFFICE_HOURS']).default('STUDY'),
  visibility: z.enum(['PRIVATE', 'UNLISTED', 'PUBLIC']).default('UNLISTED'),
  maxMembers: z.number().int().min(2).max(50).default(10),
});

/**
 * Tạo room mới. Retry tối đa 3 lần nếu joinCode collision (unique violation).
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Transaction: insert room + owner member trong cùng tx (atomic).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await db.transaction(async (tx) => {
        const joinCode = generateJoinCode();
        const [created] = await tx
          .insert(room)
          .values({
            ownerId: session.user.id,
            name: parsed.data.name,
            description: parsed.data.description,
            type: parsed.data.type,
            visibility: parsed.data.visibility,
            maxMembers: parsed.data.maxMembers,
            joinCode,
          })
          .returning();

        await tx.insert(roomMember).values({
          roomId: created!.id,
          userId: session.user.id,
          role: 'OWNER',
          status: 'ACTIVE',
        });

        return created!;
      });

      // livekitRoomName = room.id (convention) — set sau insert vì cần id
      await db.update(room).set({ livekitRoomName: result.id }).where(eq(room.id, result.id));

      return NextResponse.json({ room: { ...result, livekitRoomName: result.id } }, { status: 201 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Postgres 23505 = unique violation. Retry với joinCode mới.
      if (msg.includes('23505') && msg.includes('join_code')) continue;
      throw err;
    }
  }

  return NextResponse.json({ error: 'Không tạo được joinCode unique' }, { status: 500 });
}
