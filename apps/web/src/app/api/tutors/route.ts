/**
 * /api/tutors — Tutor profile list + create.
 *
 * GET: filter theo subjectSlug + level + modality + minRate + maxRate.
 *      Trả về list profile + subjects (JSON agg) cho /tutors browse page.
 * POST: lazy-create profile cho user hiện tại. Body: headline/bio/rate/modality.
 *       Sau đó user dùng PATCH + sub-endpoints để fill subjects + availability,
 *       cuối cùng POST /api/tutors/[id]/publish để chuyển DRAFT → PUBLISHED.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorProfile,
  tutorSubject,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const FILTER_SCHEMA = z.object({
  subjectSlug: z.string().optional(),
  level: z.string().optional(),
  modality: z.string().optional(),
  minRate: z.coerce.number().int().nonnegative().optional(),
  maxRate: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = FILTER_SCHEMA.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { subjectSlug, level, modality, minRate, maxRate, limit } = parsed.data;

  // Base where — chỉ list PUBLISHED. DRAFT/PAUSED không visible.
  const conds = [eq(tutorProfile.status, 'PUBLISHED')];
  if (modality) conds.push(eq(tutorProfile.modality, modality));
  if (minRate !== undefined) conds.push(gte(tutorProfile.hourlyRateVnd, minRate));
  if (maxRate !== undefined) conds.push(lte(tutorProfile.hourlyRateVnd, maxRate));

  // Subject filter: join tutor_subject + filter slug/level.
  // Dùng EXISTS để 1 tutor có nhiều subject vẫn return 1 row.
  if (subjectSlug) {
    conds.push(
      sql`EXISTS (
        SELECT 1 FROM ${tutorSubject}
        WHERE ${tutorSubject.tutorId} = ${tutorProfile.id}
          AND ${tutorSubject.subjectSlug} = ${subjectSlug}
          ${level ? sql`AND ${tutorSubject.level} = ${level}` : sql``}
      )`,
    );
  }

  const rows = await db
    .select({
      id: tutorProfile.id,
      headline: tutorProfile.headline,
      hourlyRateVnd: tutorProfile.hourlyRateVnd,
      modality: tutorProfile.modality,
      avatarUrl: tutorProfile.avatarUrl,
      ratingAvg: tutorProfile.ratingAvg,
      ratingCount: tutorProfile.ratingCount,
      sessionsCompleted: tutorProfile.sessionsCompleted,
      verificationStatus: tutorProfile.verificationStatus,
      userId: tutorProfile.userId,
      userName: userTable.name,
      userImage: userTable.image,
      subjects: sql<
        Array<{ slug: string; level: string; verifiedAt: string | null }>
      >`COALESCE(
        (SELECT json_agg(json_build_object(
          'slug', ${tutorSubject.subjectSlug},
          'level', ${tutorSubject.level},
          'verifiedAt', ${tutorSubject.verifiedAt}
        ))
        FROM ${tutorSubject}
        WHERE ${tutorSubject.tutorId} = ${tutorProfile.id}),
        '[]'::json
      )`,
    })
    .from(tutorProfile)
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(and(...conds))
    .orderBy(desc(tutorProfile.ratingAvg), desc(tutorProfile.sessionsCompleted))
    .limit(limit);

  return NextResponse.json({ tutors: rows });
}

const CREATE_SCHEMA = z.object({
  headline: z.string().min(10).max(160),
  bio: z.string().min(200).max(2000),
  hourlyRateVnd: z.number().int().min(10000).max(10000000),
  modality: z.enum(['ONLINE', 'OFFLINE_HN', 'OFFLINE_HCM', 'HYBRID']),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  // Idempotent — nếu user đã có profile rồi → return existing
  const existing = await db
    .select()
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, userId))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ tutor: existing[0], reused: true }, { status: 200 });
  }

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [created] = await db
    .insert(tutorProfile)
    .values({
      userId,
      headline: parsed.data.headline.trim(),
      bio: parsed.data.bio.trim(),
      hourlyRateVnd: parsed.data.hourlyRateVnd,
      modality: parsed.data.modality,
      // Status mặc định DRAFT — user phải publish riêng sau khi fill subjects.
    })
    .returning();

  return NextResponse.json({ tutor: created }, { status: 201 });
}
