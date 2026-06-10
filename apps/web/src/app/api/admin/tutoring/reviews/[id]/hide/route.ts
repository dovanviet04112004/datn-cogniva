/**
 * POST /api/admin/tutoring/reviews/[id]/hide — hide 1 review khỏi tutor profile.
 *
 * Body: { reason: string (10..500) }
 * Set hidden_at + hidden_reason + hidden_by. Product query filter
 * `WHERE hidden_at IS NULL` ở list tutor reviews → review không hiển thị.
 *
 * Auth: SUPER_ADMIN / ADMIN
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, notificationLog, tutorReview } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const BODY_SCHEMA = z.object({
  reason: z.string().trim().min(10).max(500),
});

export async function POST(request: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN', 'ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { reason } = parsed.data;

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'review.hide',
    { type: 'review', id },
    async () => {
      const [before] = await db
        .select({
          id: tutorReview.id,
          hiddenAt: tutorReview.hiddenAt,
          reviewerId: tutorReview.reviewerId,
          rating: tutorReview.rating,
        })
        .from(tutorReview)
        .where(eq(tutorReview.id, id))
        .limit(1);
      if (!before) throw new Error('Review not found');
      if (before.hiddenAt) throw new Error('Review đã hidden rồi');

      const now = new Date();
      await db
        .update(tutorReview)
        .set({ hiddenAt: now, hiddenReason: reason, hiddenBy: admin.userId })
        .where(eq(tutorReview.id, id));

      return {
        before: { hiddenAt: null },
        after: { hiddenAt: now.toISOString(), hiddenReason: reason, hiddenBy: admin.userId },
        reason,
        result: { ok: true, reviewerId: before.reviewerId },
      };
    },
  );

  // Notify reviewer biết review của họ bị hide (giúp họ tránh vi phạm tiếp)
  void db
    .insert(notificationLog)
    .values({
      userId: result.reviewerId,
      type: 'admin-review-hide',
      title: 'Review của bạn đã bị ẩn',
      body: `Lý do: ${reason}`,
      data: { reviewId: id, reason },
      status: 'pending',
    })
    .catch((err) => console.error('[admin review.hide notify] fail:', err));

  return NextResponse.json({ ok: true });
}
