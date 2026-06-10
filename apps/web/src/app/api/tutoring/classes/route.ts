/**
 * /api/tutoring/classes — V4 T4 (2026-05-22).
 *
 * GET ?subject=&level=&from=  — browse class OPEN (filter)
 * POST                          — tutor tạo class (owner check)
 *
 * Spec: docs/plans/tutoring-v4.md §3 T4.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorProfile,
  tutoringClass,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const CREATE_SCHEMA = z.object({
  title: z.string().min(8).max(120),
  description: z.string().max(2000).optional(),
  subjectSlug: z.string().min(1),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
  maxStudents: z.number().int().min(2).max(30),
  ratePerStudentVnd: z.number().int().min(10000).max(10_000_000),
  durationMin: z.number().int().min(30).max(180).default(90),
  totalSessions: z.number().int().min(1).max(48).default(1),
  scheduleType: z.enum(['ONE_OFF', 'WEEKLY', 'BIWEEKLY']),
  /** ["MON:19:00", "WED:19:00"] */
  scheduleSlots: z.array(z.string().regex(/^(MON|TUE|WED|THU|FRI|SAT|SUN):\d{2}:\d{2}$/)).min(1).max(7),
  startDate: z.string(), // ISO date YYYY-MM-DD
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const subject = url.searchParams.get('subject');
  const level = url.searchParams.get('level');
  const fromStr = url.searchParams.get('from');
  const from = fromStr ? new Date(fromStr) : new Date();

  const conds = [eq(tutoringClass.status, 'OPEN' as const)];
  if (subject) conds.push(eq(tutoringClass.subjectSlug, subject));
  if (level) conds.push(eq(tutoringClass.level, level));
  conds.push(gte(tutoringClass.startDate, from.toISOString().slice(0, 10)));

  const rows = await db
    .select({
      id: tutoringClass.id,
      tutorId: tutoringClass.tutorId,
      title: tutoringClass.title,
      description: tutoringClass.description,
      subjectSlug: tutoringClass.subjectSlug,
      level: tutoringClass.level,
      maxStudents: tutoringClass.maxStudents,
      enrolledCount: tutoringClass.enrolledCount,
      ratePerStudentVnd: tutoringClass.ratePerStudentVnd,
      durationMin: tutoringClass.durationMin,
      totalSessions: tutoringClass.totalSessions,
      scheduleType: tutoringClass.scheduleType,
      scheduleSlots: tutoringClass.scheduleSlots,
      startDate: tutoringClass.startDate,
      status: tutoringClass.status,
      tutorHeadline: tutorProfile.headline,
      tutorAvatarUrl: tutorProfile.avatarUrl,
      tutorName: userTable.name,
    })
    .from(tutoringClass)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringClass.tutorId))
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(and(...conds))
    .orderBy(asc(tutoringClass.startDate))
    .limit(50);

  return NextResponse.json({ classes: rows });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [tutor] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);
  if (!tutor) {
    return NextResponse.json(
      { error: 'Bạn chưa có tutor profile.' },
      { status: 403 },
    );
  }

  const [created] = await db
    .insert(tutoringClass)
    .values({
      tutorId: tutor.id,
      title: parsed.data.title,
      description: parsed.data.description,
      subjectSlug: parsed.data.subjectSlug,
      level: parsed.data.level,
      maxStudents: parsed.data.maxStudents,
      ratePerStudentVnd: parsed.data.ratePerStudentVnd,
      durationMin: parsed.data.durationMin,
      totalSessions: parsed.data.totalSessions,
      scheduleType: parsed.data.scheduleType,
      scheduleSlots: parsed.data.scheduleSlots,
      startDate: parsed.data.startDate,
      status: 'OPEN',
    })
    .returning();

  return NextResponse.json({ class: created }, { status: 201 });
}
