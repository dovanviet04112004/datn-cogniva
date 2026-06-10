/**
 * GET  /api/dm — list DM threads của user, sorted theo lastMessageAt DESC.
 * POST /api/dm — body { peerUserId } → upsert thread (idempotent).
 *
 * Trả thread: { id, peer: { id, name, image }, lastMessageAt }
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';

import { db, dmThread, user as userTable } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { orderUserIds } from '@/lib/group/dm';

export const runtime = 'nodejs';

const CREATE_SCHEMA = z.object({
  peerUserId: z.string().min(1),
});

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uid = session.user.id;

  // Join peer user info — peer = user1 nếu mình là user2, else user2
  const rows = await db
    .select({
      id: dmThread.id,
      user1Id: dmThread.user1Id,
      user2Id: dmThread.user2Id,
      lastMessageAt: dmThread.lastMessageAt,
      createdAt: dmThread.createdAt,
    })
    .from(dmThread)
    .where(or(eq(dmThread.user1Id, uid), eq(dmThread.user2Id, uid)))
    .orderBy(desc(dmThread.lastMessageAt));

  // Resolve peer info — batch query
  const peerIds = rows.map((r) => (r.user1Id === uid ? r.user2Id : r.user1Id));
  const peers = peerIds.length
    ? await db
        .select({ id: userTable.id, name: userTable.name, image: userTable.image })
        .from(userTable)
        .where(or(...peerIds.map((id) => eq(userTable.id, id))))
    : [];
  const peerMap = new Map(peers.map((p) => [p.id, p]));

  const threads = rows.map((r) => {
    const peerId = r.user1Id === uid ? r.user2Id : r.user1Id;
    const peer = peerMap.get(peerId);
    return {
      id: r.id,
      peer: peer ?? { id: peerId, name: 'Unknown', image: null },
      lastMessageAt: r.lastMessageAt,
      createdAt: r.createdAt,
    };
  });

  return NextResponse.json({ threads });
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const uid = session.user.id;

    const body = await request.json().catch(() => null);
    const parsed = CREATE_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    if (parsed.data.peerUserId === uid) {
      return NextResponse.json({ error: 'Không thể DM chính mình' }, { status: 400 });
    }

    // Verify peer exists
    const [peer] = await db
      .select({ id: userTable.id, name: userTable.name, image: userTable.image })
      .from(userTable)
      .where(eq(userTable.id, parsed.data.peerUserId))
      .limit(1);
    if (!peer) return NextResponse.json({ error: 'User không tồn tại' }, { status: 404 });

    const [user1Id, user2Id] = orderUserIds(uid, parsed.data.peerUserId);

    // Upsert: nếu thread đã có → return; chưa → insert
    const [existing] = await db
      .select()
      .from(dmThread)
      .where(and(eq(dmThread.user1Id, user1Id), eq(dmThread.user2Id, user2Id)))
      .limit(1);
    if (existing) {
      return NextResponse.json({ thread: { id: existing.id, peer } });
    }

    const [created] = await db
      .insert(dmThread)
      .values({ user1Id, user2Id })
      .returning();
    if (!created) {
      return NextResponse.json({ error: 'Tạo thread thất bại' }, { status: 500 });
    }

    return NextResponse.json({ thread: { id: created.id, peer } }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/dm POST] FAIL', err);
    return NextResponse.json(
      { error: 'DM endpoint crash: ' + msg },
      { status: 500 },
    );
  }
}
