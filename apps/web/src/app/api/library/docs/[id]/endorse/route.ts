/**
 * Endorsement endpoints for library docs (Phase 3, 2026-05-27).
 *
 *   POST /api/library/docs/[id]/endorse   — verified tutor endorse 1 doc
 *   GET  /api/library/docs/[id]/endorse   — list endorsements public
 *   DELETE /api/library/docs/[id]/endorse — tutor revoke endorsement
 *
 * Authz POST/DELETE: chỉ tutor có tutorProfile + verificationStatus='KYC_VERIFIED'.
 * Side effect: trigger recomputeQualityForDoc → badge `educator_approved` auto-grant
 * khi endorsementCount ≥ 1.
 */
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  libraryDoc,
  libraryDocEndorsement,
  tutorProfile,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { recomputeQualityForDoc } from '@/lib/library/quality-score';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const POST_BODY = z.object({
  note: z.string().max(500).optional(),
});

// ─── GET: list endorsements + viewer eligibility ─────────────────────
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  const rows = await db
    .select({
      id: libraryDocEndorsement.id,
      note: libraryDocEndorsement.note,
      createdAt: libraryDocEndorsement.createdAt,
      tutorId: tutorProfile.id,
      tutorHeadline: tutorProfile.headline,
      tutorAvatar: tutorProfile.avatarUrl,
      tutorUserId: tutorProfile.userId,
      tutorName: userTable.name,
      verificationStatus: tutorProfile.verificationStatus,
    })
    .from(libraryDocEndorsement)
    .innerJoin(tutorProfile, eq(tutorProfile.id, libraryDocEndorsement.tutorId))
    .leftJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(eq(libraryDocEndorsement.docId, id))
    .orderBy(desc(libraryDocEndorsement.createdAt))
    .limit(20);

  // Viewer eligibility: check session user → tutor profile → has endorsed?
  let viewer = {
    isTutor: false,
    isVerified: false,
    isPublished: false,
    hasEndorsed: false,
  };
  if (session?.user.id) {
    const [t] = await db
      .select({
        id: tutorProfile.id,
        verificationStatus: tutorProfile.verificationStatus,
        status: tutorProfile.status,
      })
      .from(tutorProfile)
      .where(eq(tutorProfile.userId, session.user.id))
      .limit(1);
    if (t) {
      viewer = {
        isTutor: true,
        isVerified: t.verificationStatus === 'KYC_VERIFIED',
        isPublished: t.status === 'PUBLISHED',
        hasEndorsed: rows.some((r) => r.tutorId === t.id),
      };
    }
  }

  return NextResponse.json({
    endorsements: rows,
    total: rows.length,
    viewer,
  });
}

// ─── POST: tutor endorse ─────────────────────────────────────────────
export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  // Verify user là tutor verified
  const [tutor] = await db
    .select({
      id: tutorProfile.id,
      verificationStatus: tutorProfile.verificationStatus,
      status: tutorProfile.status,
    })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);
  if (!tutor) {
    return NextResponse.json(
      { error: 'Chỉ tutor mới có thể endorse — đăng ký profile tại /tutoring/me' },
      { status: 403 },
    );
  }
  if (tutor.verificationStatus !== 'KYC_VERIFIED') {
    return NextResponse.json(
      { error: 'Cần verify KYC trước khi endorse — hoàn tất KYC tại /tutoring/me' },
      { status: 403 },
    );
  }
  if (tutor.status !== 'PUBLISHED') {
    return NextResponse.json(
      { error: 'Profile tutor đang DRAFT/PAUSED — publish trước' },
      { status: 403 },
    );
  }

  // Verify doc PUBLISHED
  const [doc] = await db
    .select({ id: libraryDoc.id, status: libraryDoc.status })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.status !== 'PUBLISHED') {
    return NextResponse.json({ error: 'Doc chưa PUBLISHED' }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = POST_BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Idempotent INSERT (unique constraint doc_id + tutor_id)
  try {
    await db.insert(libraryDocEndorsement).values({
      id: randomUUID(),
      docId: id,
      tutorId: tutor.id,
      note: parsed.data.note ?? null,
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'Bạn đã endorse doc này rồi' },
        { status: 409 },
      );
    }
    throw err;
  }

  // Recompute quality → educator_approved badge sẽ tự grant
  void recomputeQualityForDoc(id).catch((err) => {
    console.error('[endorse.recompute-quality]', err);
  });

  // Phase 3 Bonus #12: award karma cho uploader doc (+10)
  void (async () => {
    const [d] = await db
      .select({ uploaderId: libraryDoc.uploaderId })
      .from(libraryDoc)
      .where(eq(libraryDoc.id, id))
      .limit(1);
    if (d) {
      const { awardKarma } = await import('@/lib/library/karma');
      await awardKarma({
        userId: d.uploaderId,
        eventType: 'endorsed',
        docId: id,
        context: { tutorId: tutor.id },
      }).catch((err) => console.error('[karma.endorsed]', err));
    }
  })();

  return NextResponse.json({ ok: true, message: 'Đã endorse — cảm ơn tutor!' });
}

// ─── DELETE: tutor revoke endorsement ────────────────────────────────
export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const [tutor] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);
  if (!tutor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await db
    .delete(libraryDocEndorsement)
    .where(
      and(
        eq(libraryDocEndorsement.docId, id),
        eq(libraryDocEndorsement.tutorId, tutor.id),
      ),
    )
    .returning({ id: libraryDocEndorsement.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'Chưa endorse' }, { status: 404 });
  }

  void recomputeQualityForDoc(id).catch(() => {});
  return NextResponse.json({ ok: true });
}
