/**
 * /api/tutoring/payouts — tutor list + request payout.
 *
 * GET: list payouts của tutor hiện tại + computed earnings summary.
 *   - earned       : tổng amount payment CAPTURED chưa refund
 *   - released     : tổng đã qua escrowReleaseAt (đủ điều kiện rút)
 *   - paidOut      : tổng payout đã PAID
 *   - pending      : tổng payout đang REQUESTED/APPROVED
 *   - withdrawable : released - paidOut - pending
 *
 * POST: tạo payout request. Body { amountVnd, method?, accountDetails }.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorPayout,
  tutorProfile,
  tutoringBooking,
  tutoringPayment,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

async function getMyTutor(userId: string) {
  const [row] = await db
    .select({
      id: tutorProfile.id,
      verificationStatus: tutorProfile.verificationStatus,
    })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, userId))
    .limit(1);
  return row ?? null;
}

async function computeEarnings(tutorId: string) {
  // Tổng net earnings = sum(amount - fee) cho payment CAPTURED của booking
  // của tutor này, không tính booking CANCELLED/REFUNDED.
  const earnedRow = await db
    .select({
      total: sql<number>`COALESCE(SUM(${tutoringPayment.amountVnd} - ${tutoringPayment.feeVnd}), 0)::int`,
      released: sql<number>`COALESCE(SUM(
        CASE WHEN ${tutoringPayment.escrowReleaseAt} IS NOT NULL
                  AND ${tutoringPayment.escrowReleaseAt} <= NOW()
             THEN ${tutoringPayment.amountVnd} - ${tutoringPayment.feeVnd}
             ELSE 0 END
      ), 0)::int`,
    })
    .from(tutoringPayment)
    .innerJoin(tutoringBooking, eq(tutoringBooking.id, tutoringPayment.bookingId))
    .where(
      and(
        eq(tutoringBooking.tutorId, tutorId),
        eq(tutoringPayment.status, 'CAPTURED'),
      ),
    );

  const paidOutRow = await db
    .select({
      paidOut: sql<number>`COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount_vnd ELSE 0 END), 0)::int`,
      pending: sql<number>`COALESCE(SUM(CASE WHEN status IN ('REQUESTED','APPROVED') THEN amount_vnd ELSE 0 END), 0)::int`,
    })
    .from(tutorPayout)
    .where(eq(tutorPayout.tutorId, tutorId));

  const earned = Number(earnedRow[0]?.total ?? 0);
  const released = Number(earnedRow[0]?.released ?? 0);
  const paidOut = Number(paidOutRow[0]?.paidOut ?? 0);
  const pending = Number(paidOutRow[0]?.pending ?? 0);
  const withdrawable = Math.max(0, released - paidOut - pending);

  return { earned, released, paidOut, pending, withdrawable };
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const mine = await getMyTutor(userId);
  if (!mine) {
    return NextResponse.json({
      tutor: null,
      payouts: [],
      summary: { earned: 0, released: 0, paidOut: 0, pending: 0, withdrawable: 0 },
    });
  }

  const [payouts, summary] = await Promise.all([
    db
      .select()
      .from(tutorPayout)
      .where(eq(tutorPayout.tutorId, mine.id))
      .orderBy(desc(tutorPayout.requestedAt))
      .limit(20),
    computeEarnings(mine.id),
  ]);

  return NextResponse.json({
    tutor: mine,
    payouts,
    summary,
  });
}

const SCHEMA = z.object({
  amountVnd: z.number().int().min(50000), // tối thiểu 50K
  method: z.enum(['BANK_TRANSFER', 'MOMO_WALLET']).default('BANK_TRANSFER'),
  accountDetails: z.object({
    bankName: z.string().optional(),
    accountNumber: z.string().optional(),
    accountHolder: z.string().optional(),
    phone: z.string().optional(),
  }),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const mine = await getMyTutor(userId);
  if (!mine) {
    return NextResponse.json({ error: 'Bạn không phải tutor' }, { status: 403 });
  }
  if (mine.verificationStatus !== 'KYC_VERIFIED') {
    return NextResponse.json(
      { error: 'Cần KYC verified trước khi rút tiền' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const summary = await computeEarnings(mine.id);
  if (parsed.data.amountVnd > summary.withdrawable) {
    return NextResponse.json(
      {
        error: `Số tiền vượt quá khả năng rút (${summary.withdrawable} VND)`,
        summary,
      },
      { status: 400 },
    );
  }

  const [created] = await db
    .insert(tutorPayout)
    .values({
      tutorId: mine.id,
      amountVnd: parsed.data.amountVnd,
      method: parsed.data.method,
      accountDetails: parsed.data.accountDetails,
      status: 'REQUESTED',
    })
    .returning();

  return NextResponse.json({ payout: created }, { status: 201 });
}
