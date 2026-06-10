/**
 * /api/tutors/[id]/subjects — POST add subject.
 *
 * Validate slug + level qua taxonomy. Skip ON CONFLICT (unique index).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, tutorProfile, tutorSubject, validateSubject } from '@cogniva/db';
import type { SubjectLevel } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const CREATE_SCHEMA = z.object({
  subjectSlug: z.string().min(1),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
});

export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // Verify ownership
  const [existing] = await db
    .select({ userId: tutorProfile.userId })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Validate taxonomy
  const subject = validateSubject(
    parsed.data.subjectSlug,
    parsed.data.level as SubjectLevel,
  );
  if (!subject) {
    return NextResponse.json(
      { error: 'Môn / level không hợp lệ' },
      { status: 400 },
    );
  }

  try {
    const [inserted] = await db
      .insert(tutorSubject)
      .values({
        tutorId: id,
        subjectSlug: parsed.data.subjectSlug,
        level: parsed.data.level,
      })
      .returning();
    return NextResponse.json({ subject: inserted }, { status: 201 });
  } catch (err) {
    // Unique constraint violation — đã có cùng (tutor, slug, level)
    return NextResponse.json(
      { error: 'Môn này đã được thêm', details: (err as Error).message },
      { status: 409 },
    );
  }
}
