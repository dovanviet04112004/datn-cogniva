/**
 * /api/groups — list groups của user + tạo group mới.
 *
 * GET: trả mảng groups user là member kèm số thành viên.
 * POST body { name, description? }: tạo group, auto-add owner làm OWNER member.
 *   Sinh inviteCode random 8 ký tự.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroup, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

/** Sinh invite code 8 ký tự A-Z0-9 (loại 0/O/1/I để tránh nhìn nhầm). */
function genInviteCode(): string {
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) out += ALPHA[b % ALPHA.length];
  return out;
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Group user là member, kèm count thành viên
  const rows = await db
    .select({
      id: studyGroup.id,
      name: studyGroup.name,
      description: studyGroup.description,
      ownerUserId: studyGroup.ownerUserId,
      inviteCode: studyGroup.inviteCode,
      createdAt: studyGroup.createdAt,
      myRole: studyGroupMember.role,
      memberCount: sql<number>`(SELECT count(*)::int FROM study_group_member WHERE group_id = ${studyGroup.id})`,
    })
    .from(studyGroup)
    .innerJoin(studyGroupMember, eq(studyGroupMember.groupId, studyGroup.id))
    .where(eq(studyGroupMember.userId, session.user.id))
    .orderBy(desc(studyGroup.createdAt));

  return NextResponse.json({ groups: rows });
}

const CREATE_SCHEMA = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Tạo group + auto-add owner làm OWNER member
  const [group] = await db
    .insert(studyGroup)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      ownerUserId: session.user.id,
      inviteCode: genInviteCode(),
    })
    .returning();
  if (!group) {
    return NextResponse.json({ error: 'Tạo group thất bại' }, { status: 500 });
  }

  await db.insert(studyGroupMember).values({
    groupId: group.id,
    userId: session.user.id,
    role: 'OWNER',
  });

  return NextResponse.json({ group }, { status: 201 });
}
