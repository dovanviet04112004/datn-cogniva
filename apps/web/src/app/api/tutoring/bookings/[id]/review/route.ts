/**
 * POST /api/tutoring/bookings/[id]/review — student review tutor sau session.
 *
 * Validation:
 *   - Booking phải status COMPLETED
 *   - User là student của booking
 *   - Chưa có review cho booking này (unique constraint trong DB cũng catch)
 *   - Rating 1-5
 *
 * Side effects: refresh rating_avg + rating_count trên tutor_profile.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, tutorReview, tutoringBooking } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { refreshTutorStats } from '@/lib/tutoring/booking-helpers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const SCHEMA = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: tutoringBooking.id,
      status: tutoringBooking.status,
      tutorId: tutoringBooking.tutorId,
      studentId: tutoringBooking.studentId,
    })
    .from(tutoringBooking)
    .where(eq(tutoringBooking.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.studentId !== userId) {
    return NextResponse.json(
      { error: 'Chỉ học sinh tham gia mới review được' },
      { status: 403 },
    );
  }
  if (row.status !== 'COMPLETED') {
    return NextResponse.json(
      { error: 'Chỉ review được buổi đã COMPLETED' },
      { status: 400 },
    );
  }

  // Check trùng — unique(bookingId)
  const [existing] = await db
    .select({ id: tutorReview.id })
    .from(tutorReview)
    .where(eq(tutorReview.bookingId, id))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: 'Bạn đã review buổi này' },
      { status: 409 },
    );
  }

  const [created] = await db
    .insert(tutorReview)
    .values({
      bookingId: id,
      reviewerId: userId,
      tutorId: row.tutorId,
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
    })
    .returning();

  await refreshTutorStats(row.tutorId);

  return NextResponse.json({ review: created }, { status: 201 });
}
