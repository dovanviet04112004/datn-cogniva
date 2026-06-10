/**
 * POST /api/tutoring/compare — V4 T5 (2026-05-22).
 *
 * Bulk fetch detail của 2-4 tutor cho comparison view.
 * Trả side-by-side data: rate, rating, response, subjects, sample availability,
 * pack giá tốt nhất.
 *
 * Body: { tutorIds: string[] } (2-4 ids)
 *
 * Spec: docs/plans/tutoring-v4.md §7.6.
 */
import { NextResponse } from 'next/server';
import { and, between, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorAvailability,
  tutorProfile,
  tutorSubject,
  tutoringBooking,
  tutoringPack,
  user as userTable,
} from '@cogniva/db';

export const runtime = 'nodejs';

const BODY_SCHEMA = z.object({
  tutorIds: z.array(z.string().min(1)).min(2).max(4),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const ids = parsed.data.tutorIds;

  // Bulk fetch tutor profiles
  const tutors = await db
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
      instantBookEnabled: tutorProfile.instantBookEnabled,
      avgResponseMinutes: tutorProfile.avgResponseMinutes,
      responseRatePct: tutorProfile.responseRatePct,
      tutorName: userTable.name,
    })
    .from(tutorProfile)
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(inArray(tutorProfile.id, ids));

  if (tutors.length === 0) {
    return NextResponse.json({ tutors: [] });
  }

  // Bulk fetch subjects
  const subjects = await db
    .select()
    .from(tutorSubject)
    .where(inArray(tutorSubject.tutorId, ids));

  // Bulk fetch best pack (lowest rate / session) — typed inArray để bind đúng
  const packs = await db
    .select()
    .from(tutoringPack)
    .where(
      and(
        inArray(tutoringPack.tutorId, ids),
        eq(tutoringPack.status, 'ACTIVE'),
      ),
    );

  // Bulk fetch next available slot (7 days ahead) — typed query
  const now = new Date();
  const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingBookings = await db
    .select({
      tutorId: tutoringBooking.tutorId,
      startAt: tutoringBooking.startAt,
      endAt: tutoringBooking.endAt,
    })
    .from(tutoringBooking)
    .where(
      and(
        inArray(tutoringBooking.tutorId, ids),
        inArray(tutoringBooking.status, ['CONFIRMED', 'PENDING_TUTOR', 'IN_PROGRESS']),
        between(tutoringBooking.startAt, now, sevenDaysAhead),
      ),
    );

  const availability = await db
    .select()
    .from(tutorAvailability)
    .where(inArray(tutorAvailability.tutorId, ids));

  // Build compare row per tutor
  const compareRows = tutors.map((t) => {
    const subjList = subjects.filter((s) => s.tutorId === t.id);
    const packsForTutor = packs.filter((p) => p.tutorId === t.id);
    const bestPack = packsForTutor.sort((a, b) => a.ratePerSessionVnd - b.ratePerSessionVnd)[0];
    const hasSlots = availability.some((a) => a.tutorId === t.id);

    // Find next slot — đơn giản return next availability day-of-week tới
    let nextSlot: Date | null = null;
    if (hasSlots) {
      const conflicts = upcomingBookings.filter((b) => b.tutorId === t.id);
      // Heuristic: pick tutor avail of day-of-week kế tiếp + check no conflict
      const tutorAvail = availability
        .filter((a) => a.tutorId === t.id)
        .sort((a, b) =>
          a.dayOfWeek === b.dayOfWeek
            ? a.startTime.localeCompare(b.startTime)
            : a.dayOfWeek - b.dayOfWeek,
        );
      for (let i = 0; i < 7; i++) {
        const dayCheck = new Date(now);
        dayCheck.setDate(now.getDate() + i);
        const dow = dayCheck.getDay();
        const avs = tutorAvail.filter((a) => a.dayOfWeek === dow);
        for (const av of avs) {
          const [h, m] = av.startTime.split(':').map((p) => parseInt(p, 10));
          const slot = new Date(dayCheck);
          slot.setHours(h!, m!, 0, 0);
          if (slot.getTime() < now.getTime() + 60 * 60 * 1000) continue;
          // Check conflict
          const inConflict = conflicts.some(
            (b) => b.startAt <= slot && b.endAt > slot,
          );
          if (!inConflict) {
            nextSlot = slot;
            break;
          }
        }
        if (nextSlot) break;
      }
    }

    return {
      id: t.id,
      name: t.tutorName,
      headline: t.headline,
      avatarUrl: t.avatarUrl,
      hourlyRateVnd: t.hourlyRateVnd,
      ratingAvg: t.ratingAvg ? Number(t.ratingAvg) : null,
      ratingCount: t.ratingCount,
      sessionsCompleted: t.sessionsCompleted,
      verificationStatus: t.verificationStatus,
      modality: t.modality,
      instantBookEnabled: t.instantBookEnabled,
      avgResponseMinutes: t.avgResponseMinutes,
      responseRatePct: t.responseRatePct,
      subjects: subjList.map((s) => ({
        slug: s.subjectSlug,
        level: s.level,
        verified: !!s.verifiedAt,
      })),
      bestPack: bestPack
        ? {
            sessionCount: bestPack.sessionCount,
            totalVnd: bestPack.totalVnd,
            ratePerSessionVnd: bestPack.ratePerSessionVnd,
            discountPct: bestPack.discountPct,
          }
        : null,
      nextSlot: nextSlot?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ tutors: compareRows });
}
