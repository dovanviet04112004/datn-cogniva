/**
 * /api/groups/[id]/invites — list + create invite links.
 *
 * GET: trả mọi invite của group (mọi member xem được, dùng để clone link share)
 * POST { maxUses?, expiresInSec? }: tạo invite mới
 *   - Mọi member có quyền tạo invite (như Discord)
 *   - maxUses NULL = unlimited, expiresInSec NULL = never
 *
 * Rate limit V2: 10 invite/hour/user.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

// `db` cho write (POST insert invite) + auth-check membership;
// `dbReplica` cho read thuần GET (list invites).
import { db, dbReplica, studyGroupInvite, studyGroupMember, user } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, type GroupRole } from '@/lib/group/permissions';
import { generateInviteCode } from '@/lib/group/code';

export const runtime = 'nodejs';

const CREATE_SCHEMA = z.object({
  /** Số lượt tối đa — NULL = unlimited */
  maxUses: z.number().int().min(1).max(10_000).nullable().optional(),
  /** Hết hạn sau N giây — NULL = never. Cap 30 ngày. */
  expiresInSec: z.number().int().min(60).max(60 * 60 * 24 * 30).nullable().optional(),
});

async function getMembership(groupId: string, userId: string) {
  const [m] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, groupId), eq(studyGroupMember.userId, userId)),
    )
    .limit(1);
  return m ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  // Read thuần list invites → đọc qua replica
  const invites = await dbReplica
    .select({
      id: studyGroupInvite.id,
      code: studyGroupInvite.code,
      createdBy: studyGroupInvite.createdBy,
      createdByName: user.name,
      maxUses: studyGroupInvite.maxUses,
      usesCount: studyGroupInvite.usesCount,
      expiresAt: studyGroupInvite.expiresAt,
      createdAt: studyGroupInvite.createdAt,
    })
    .from(studyGroupInvite)
    .innerJoin(user, eq(user.id, studyGroupInvite.createdBy))
    .where(eq(studyGroupInvite.groupId, groupId))
    .orderBy(desc(studyGroupInvite.createdAt));

  return NextResponse.json({ invites });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (!can(me.role as GroupRole, 'invite.create')) {
    return NextResponse.json({ error: 'Không có quyền tạo invite' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Retry tối đa 5 lần nếu code va đập (gần như impossible với 32^8)
  let inserted = null;
  for (let i = 0; i < 5; i++) {
    const code = generateInviteCode();
    try {
      const expiresAt = parsed.data.expiresInSec
        ? new Date(Date.now() + parsed.data.expiresInSec * 1000)
        : null;
      const [row] = await db
        .insert(studyGroupInvite)
        .values({
          groupId,
          code,
          createdBy: session.user.id,
          maxUses: parsed.data.maxUses ?? null,
          expiresAt,
        })
        .returning();
      inserted = row;
      break;
    } catch (err) {
      // Unique violation — retry với code mới
      if (i === 4) throw err;
    }
  }

  return NextResponse.json({ invite: inserted }, { status: 201 });
}
