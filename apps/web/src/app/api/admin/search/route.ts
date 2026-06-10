/**
 * GET /api/admin/search?q=... — global ⌘K search cho admin console.
 *
 * Search 5 entity types song song:
 *   - user (name + email)
 *   - document (filename)
 *   - conversation (title)
 *   - group (name)
 *   - booking (id prefix exact)
 *
 * Mỗi type trả tối đa 5 result. Tổng 25. Substring ILIKE — đủ cho dataset
 * scope admin (10K-100K rows). Bigger scale → Phase 6.1 wire tsvector.
 */
import { NextResponse } from 'next/server';
import { aliasedTable, desc, eq, ilike, or, sql } from 'drizzle-orm';

import {
  conversation,
  db,
  document,
  studyGroup,
  tutorProfile,
  tutoringBooking,
  user,
} from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PER_TYPE_LIMIT = 5;

const tutorUser = aliasedTable(user, 'tutor_u');
const studentUser = aliasedTable(user, 'student_u');

export type AdminSearchHit = {
  type: 'user' | 'document' | 'conversation' | 'group' | 'booking';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

export async function GET(request: Request) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ hits: [] });
  }
  const pattern = `%${q}%`;

  const [users, docs, convs, groups, bookings] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        suspendedAt: user.suspendedAt,
      })
      .from(user)
      .where(or(ilike(user.name, pattern), ilike(user.email, pattern))!)
      .limit(PER_TYPE_LIMIT),
    db
      .select({
        id: document.id,
        filename: document.filename,
        status: document.status,
        userEmail: user.email,
      })
      .from(document)
      .leftJoin(user, eq(user.id, document.userId))
      .where(ilike(document.filename, pattern))
      .orderBy(desc(document.createdAt))
      .limit(PER_TYPE_LIMIT),
    db
      .select({
        id: conversation.id,
        title: conversation.title,
        userEmail: user.email,
      })
      .from(conversation)
      .leftJoin(user, eq(user.id, conversation.userId))
      .where(ilike(conversation.title, pattern))
      .orderBy(desc(conversation.createdAt))
      .limit(PER_TYPE_LIMIT),
    db
      .select({
        id: studyGroup.id,
        name: studyGroup.name,
        suspendedAt: studyGroup.suspendedAt,
        memberCount: sql<number>`(
          SELECT COUNT(*)::int FROM "study_group_member"
          WHERE "study_group_member".group_id = ${studyGroup.id}
        )`,
      })
      .from(studyGroup)
      .where(ilike(studyGroup.name, pattern))
      .limit(PER_TYPE_LIMIT),
    db
      .select({
        id: tutoringBooking.id,
        subjectSlug: tutoringBooking.subjectSlug,
        status: tutoringBooking.status,
        startAt: tutoringBooking.startAt,
        tutorEmail: tutorUser.email,
        studentEmail: studentUser.email,
      })
      .from(tutoringBooking)
      .leftJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
      .leftJoin(tutorUser, eq(tutorUser.id, tutorProfile.userId))
      .leftJoin(studentUser, eq(studentUser.id, tutoringBooking.studentId))
      .where(
        or(
          ilike(tutorUser.email, pattern),
          ilike(studentUser.email, pattern),
          // ID prefix exact match — paste UUID/cuid
          q.length >= 6 ? eq(tutoringBooking.id, q) : sql`false`,
        )!,
      )
      .orderBy(desc(tutoringBooking.startAt))
      .limit(PER_TYPE_LIMIT),
  ]);

  const hits: AdminSearchHit[] = [
    ...users.map((u) => ({
      type: 'user' as const,
      id: u.id,
      title: u.name ?? u.email,
      subtitle: `${u.email} · ${u.plan}${u.suspendedAt ? ' · suspended' : ''}`,
      href: `/admin/users/${u.id}`,
    })),
    ...docs.map((d) => ({
      type: 'document' as const,
      id: d.id,
      title: d.filename,
      subtitle: `${d.status}${d.userEmail ? ` · ${d.userEmail}` : ''}`,
      href: `/admin/documents/${d.id}`,
    })),
    ...convs.map((c) => ({
      type: 'conversation' as const,
      id: c.id,
      title: c.title || '— không có tiêu đề —',
      subtitle: c.userEmail,
      href: `/admin/conversations/${c.id}`,
    })),
    ...groups.map((g) => ({
      type: 'group' as const,
      id: g.id,
      title: g.name,
      subtitle: `${g.memberCount} members${g.suspendedAt ? ' · suspended' : ''}`,
      href: `/admin/groups/${g.id}`,
    })),
    ...bookings.map((b) => ({
      type: 'booking' as const,
      id: b.id,
      title: `${b.subjectSlug} · ${new Date(b.startAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
      subtitle: `${b.status} · ${b.studentEmail ?? '—'} ← ${b.tutorEmail ?? '—'}`,
      href: `/admin/tutoring/bookings/${b.id}`,
    })),
  ];

  return NextResponse.json({ hits });
}
