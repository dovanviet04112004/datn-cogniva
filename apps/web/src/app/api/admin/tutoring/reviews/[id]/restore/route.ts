/**
 * POST /api/admin/tutoring/reviews/[id]/restore — unhide 1 review.
 *
 * Body: { reason: string (10..500) }
 * Clear hidden_at + hidden_reason + hidden_by.
 *
 * Auth: SUPER_ADMIN / ADMIN
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, tutorReview } from '@cogniva/db';

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

  await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'review.restore',
    { type: 'review', id },
    async () => {
      const [before] = await db
        .select({ hiddenAt: tutorReview.hiddenAt })
        .from(tutorReview)
        .where(eq(tutorReview.id, id))
        .limit(1);
      if (!before) throw new Error('Review not found');
      if (!before.hiddenAt) throw new Error('Review không bị hidden');

      await db
        .update(tutorReview)
        .set({ hiddenAt: null, hiddenReason: null, hiddenBy: null })
        .where(eq(tutorReview.id, id));

      return {
        before: { hiddenAt: before.hiddenAt.toISOString() },
        after: { hiddenAt: null },
        reason,
        result: { ok: true },
      };
    },
  );

  return NextResponse.json({ ok: true });
}
