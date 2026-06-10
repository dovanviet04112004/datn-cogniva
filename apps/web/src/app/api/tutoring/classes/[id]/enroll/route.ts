/**
 * POST /api/tutoring/classes/[id]/enroll — V4 T4 (2026-05-22).
 *
 * Student enroll vào group class:
 *   1. Validate class OPEN + còn slot
 *   2. Charge wallet rate_per_student_vnd
 *   3. Tạo enrollment + tăng enrolled_count (atomic)
 *   4. Nếu enrolled_count = max_students → status = FULL
 *
 * Nếu class FULL → trả 409, FE redirect /waitlist endpoint.
 *
 * Spec: docs/plans/tutoring-v4.md §3 T4.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';

import {
  db,
  tutoringClass,
  tutoringClassEnrollment,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  chargeWallet,
  InsufficientBalanceError,
} from '@/lib/tutoring/wallet';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: classId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return db.transaction(async (tx) => {
    const [cls] = await tx
      .select()
      .from(tutoringClass)
      .where(eq(tutoringClass.id, classId))
      .for('update');
    if (!cls) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 });
    }
    if (cls.status !== 'OPEN') {
      return NextResponse.json({ error: `Class đang ở trạng thái ${cls.status}` }, { status: 400 });
    }
    if (cls.enrolledCount >= cls.maxStudents) {
      return NextResponse.json({ error: 'Class đã đầy — dùng waitlist' }, { status: 409 });
    }

    // Check đã enroll chưa
    const [existing] = await tx
      .select({ id: tutoringClassEnrollment.id })
      .from(tutoringClassEnrollment)
      .where(
        and(
          eq(tutoringClassEnrollment.classId, classId),
          eq(tutoringClassEnrollment.studentId, session.user.id),
        ),
      )
      .limit(1);
    if (existing) {
      return NextResponse.json({ error: 'Bạn đã enroll lớp này rồi' }, { status: 400 });
    }

    // Charge wallet
    let chargeResult;
    try {
      chargeResult = await chargeWallet({
        userId: session.user.id,
        amountVnd: cls.ratePerStudentVnd,
        type: 'BOOKING_PAY',
        relatedType: 'class_enrollment',
        relatedId: classId,
        description: `Enroll lớp ${cls.title}`,
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return NextResponse.json(
          {
            error: 'Số dư không đủ — nạp wallet để enroll',
            required: err.required,
            available: err.available,
          },
          { status: 402 },
        );
      }
      throw err;
    }

    const [enrollment] = await tx
      .insert(tutoringClassEnrollment)
      .values({
        classId,
        studentId: session.user.id,
        status: 'ENROLLED',
      })
      .returning();

    // Update enrolled_count, set FULL nếu đạt max
    const newCount = cls.enrolledCount + 1;
    const newStatus = newCount >= cls.maxStudents ? 'FULL' : 'OPEN';
    await tx
      .update(tutoringClass)
      .set({ enrolledCount: newCount, status: newStatus })
      .where(eq(tutoringClass.id, classId));

    return NextResponse.json({
      enrollment,
      walletTxnId: chargeResult.txnId,
      classStatus: newStatus,
    }, { status: 201 });
  });
}

// Helper unused but exported elsewhere
void sql;
