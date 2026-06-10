/**
 * /api/tutoring/applications/[id] — student accept/reject application.
 *
 * PATCH body { status: 'ACCEPTED' | 'REJECTED' }
 *
 * Khi ACCEPTED:
 *   - Application → ACCEPTED
 *   - Các application khác cùng request → auto REJECTED
 *   - Request → MATCHED
 *
 * V2 sẽ auto-create study group + booking ở step này.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';

import { db, tutorApplication, tutorProfile, tutorRequest } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onTutoringMineChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const PATCH_SCHEMA = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED']),
});

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Load application + verify owner (student của request). Join tutorProfile để lấy
  // userId của tutor — cần để xoá cache MineTab "Đơn đã apply" của họ sau khi đổi status.
  const [app] = await db
    .select({
      id: tutorApplication.id,
      requestId: tutorApplication.requestId,
      status: tutorApplication.status,
      tutorUserId: tutorProfile.userId,
    })
    .from(tutorApplication)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutorApplication.tutorId))
    .where(eq(tutorApplication.id, id))
    .limit(1);
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [req] = await db
    .select({ studentId: tutorRequest.studentId, status: tutorRequest.status })
    .from(tutorRequest)
    .where(eq(tutorRequest.id, app.requestId))
    .limit(1);
  if (!req) return NextResponse.json({ error: 'Request gone' }, { status: 404 });
  if (req.studentId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (app.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'Application đã xử lý rồi' },
      { status: 400 },
    );
  }

  // ACCEPT: cascade reject others + close request
  if (parsed.data.status === 'ACCEPTED') {
    // Gom userId các tutor có app PENDING khác (sẽ bị auto-reject) — fetch TRƯỚC khi
    // update để còn lấy được, dùng xoá cache MineTab "Đơn đã apply" của họ sau commit.
    const cascadeRejected = await db
      .select({ tutorUserId: tutorProfile.userId })
      .from(tutorApplication)
      .innerJoin(tutorProfile, eq(tutorProfile.id, tutorApplication.tutorId))
      .where(
        and(
          eq(tutorApplication.requestId, app.requestId),
          eq(tutorApplication.status, 'PENDING'),
          ne(tutorApplication.id, id),
        ),
      );

    await db.transaction(async (tx) => {
      await tx
        .update(tutorApplication)
        .set({ status: 'ACCEPTED' })
        .where(eq(tutorApplication.id, id));
      await tx
        .update(tutorApplication)
        .set({ status: 'REJECTED' })
        .where(
          and(
            eq(tutorApplication.requestId, app.requestId),
            eq(tutorApplication.status, 'PENDING'),
            ne(tutorApplication.id, id),
          ),
        );
      await tx
        .update(tutorRequest)
        .set({ status: 'MATCHED' })
        .where(eq(tutorRequest.id, app.requestId));
    });

    // Invalidate MineTab cho: student (request → MATCHED), tutor được chọn, và mọi
    // tutor bị auto-reject (app status đổi → "Đơn đã apply" của họ đổi). Dedupe để
    // không xoá trùng 1 user 2 lần.
    const affected = new Set<string>([session.user.id, app.tutorUserId]);
    for (const r of cascadeRejected) affected.add(r.tutorUserId);
    await Promise.all([...affected].map((uid) => onTutoringMineChanged(uid)));

    return NextResponse.json({ ok: true, status: 'ACCEPTED' });
  }

  // REJECT: chỉ application này, request vẫn OPEN
  await db
    .update(tutorApplication)
    .set({ status: 'REJECTED' })
    .where(eq(tutorApplication.id, id));

  // Chỉ status app của tutor này đổi (request vẫn OPEN → student "Yêu cầu" không đổi)
  // → xoá cache MineTab của riêng tutor bị từ chối.
  await onTutoringMineChanged(app.tutorUserId);

  return NextResponse.json({ ok: true, status: 'REJECTED' });
}
