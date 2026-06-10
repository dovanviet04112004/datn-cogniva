/**
 * PATCH /api/admin/kyc/[id] — admin approve/reject 1 KYC document.
 *
 * Body: { action: 'APPROVE' | 'REJECT', note?: string }
 *
 * Side effect: nếu sau action này tutor đủ điều kiện (≥1 CCCD_FRONT +
 * ≥1 CCCD_BACK + ≥1 DEGREE approved) → set profile.verificationStatus
 * = KYC_VERIFIED. Nếu mọi doc còn lại đều REJECTED → giữ KYC_PENDING (chờ
 * upload lại).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorKycDocument,
  tutorProfile,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin/guard';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const SCHEMA = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(500).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const adminId = session.user.id;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [doc] = await db
    .select({ id: tutorKycDocument.id, tutorId: tutorKycDocument.tutorId })
    .from(tutorKycDocument)
    .where(eq(tutorKycDocument.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const newStatus = parsed.data.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await db
    .update(tutorKycDocument)
    .set({
      status: newStatus,
      reviewedBy: adminId,
      reviewNote: parsed.data.note ?? null,
      reviewedAt: new Date(),
    })
    .where(eq(tutorKycDocument.id, id));

  // Recompute verification status — cần đủ CCCD_FRONT + CCCD_BACK + DEGREE
  const approved = await db
    .select({ docType: tutorKycDocument.docType })
    .from(tutorKycDocument)
    .where(
      and(
        eq(tutorKycDocument.tutorId, doc.tutorId),
        eq(tutorKycDocument.status, 'APPROVED'),
      ),
    );
  const types = new Set(approved.map((d) => d.docType));
  const hasIdentity = types.has('CCCD_FRONT') && types.has('CCCD_BACK');
  const hasDegree = types.has('DEGREE') || types.has('CERTIFICATE');
  const fullyVerified = hasIdentity && hasDegree;

  await db
    .update(tutorProfile)
    .set({
      verificationStatus: fullyVerified ? 'KYC_VERIFIED' : 'KYC_PENDING',
      updatedAt: new Date(),
    })
    .where(eq(tutorProfile.id, doc.tutorId));

  return NextResponse.json({ ok: true, verificationStatus: fullyVerified ? 'KYC_VERIFIED' : 'KYC_PENDING' });
}
