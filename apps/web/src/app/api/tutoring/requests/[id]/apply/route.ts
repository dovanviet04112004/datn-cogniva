/**
 * /api/tutoring/requests/[id]/apply — tutor apply vào request.
 *
 * Yêu cầu:
 *   1. User phải có tutor_profile (status PUBLISHED ưu tiên, DRAFT OK ở V1)
 *   2. Request status = OPEN
 *   3. Chưa apply trước đó (unique constraint)
 *   4. Không phải student tự apply request của mình
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorApplication,
  tutorProfile,
  tutorRequest,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onTutoringMineChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const APPLY_SCHEMA = z.object({
  message: z.string().min(20).max(1000),
  proposedRateVnd: z.number().int().min(10000).max(10000000),
});

export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // 1. Phải có tutor profile
  const [myProfile] = await db
    .select({ id: tutorProfile.id, status: tutorProfile.status })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);
  if (!myProfile) {
    return NextResponse.json(
      { error: 'Cần tạo tutor profile trước khi apply' },
      { status: 403 },
    );
  }

  // 2. Request phải OPEN + không self
  const [req] = await db
    .select({ studentId: tutorRequest.studentId, status: tutorRequest.status })
    .from(tutorRequest)
    .where(eq(tutorRequest.id, id))
    .limit(1);
  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (req.status !== 'OPEN') {
    return NextResponse.json(
      { error: 'Request đã đóng, không thể apply' },
      { status: 400 },
    );
  }
  if (req.studentId === session.user.id) {
    return NextResponse.json(
      { error: 'Không thể apply vào request của chính mình' },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = APPLY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const [created] = await db
      .insert(tutorApplication)
      .values({
        requestId: id,
        tutorId: myProfile.id,
        message: parsed.data.message.trim(),
        proposedRateVnd: parsed.data.proposedRateVnd,
      })
      .returning();

    // Application mới hiện ở "Đơn đã apply" trong MineTab của tutor → xoá cache mine của họ.
    await onTutoringMineChanged(session.user.id);

    return NextResponse.json({ application: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: 'Bạn đã apply request này rồi', details: (err as Error).message },
      { status: 409 },
    );
  }
}
