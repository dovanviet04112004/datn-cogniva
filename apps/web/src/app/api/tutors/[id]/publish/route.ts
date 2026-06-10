/**
 * /api/tutors/[id]/publish — flip status DRAFT → PUBLISHED.
 *
 * Validation trước khi publish:
 *   1. Phải có ≥ 1 subject
 *   2. Phải có ≥ 1 availability slot
 *   3. Bio đủ độ dài (đã enforce ở schema)
 *
 * Endpoint riêng (không qua PATCH /api/tutors/[id]) để có guard rõ ràng.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { count, eq } from 'drizzle-orm';

import {
  db,
  tutorAvailability,
  tutorProfile,
  tutorSubject,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { embedQuery } from '@/lib/ingest/embed-query';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const [existing] = await db
    .select({
      userId: tutorProfile.userId,
      status: tutorProfile.status,
      bio: tutorProfile.bio,
      headline: tutorProfile.headline,
    })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Guard — phải có subject + availability
  const [subjCount] = await db
    .select({ n: count(tutorSubject.id) })
    .from(tutorSubject)
    .where(eq(tutorSubject.tutorId, id));
  if ((subjCount?.n ?? 0) === 0) {
    return NextResponse.json(
      { error: 'Cần ít nhất 1 môn dạy trước khi publish' },
      { status: 400 },
    );
  }

  const [availCount] = await db
    .select({ n: count(tutorAvailability.id) })
    .from(tutorAvailability)
    .where(eq(tutorAvailability.tutorId, id));
  if ((availCount?.n ?? 0) === 0) {
    return NextResponse.json(
      { error: 'Cần ít nhất 1 khung giờ rảnh trước khi publish' },
      { status: 400 },
    );
  }

  // Embed bio + headline NGAY khi publish — semantic search hoạt động liền,
  // không phải đợi cron 03:00 sáng. Fail-soft: nếu embed lỗi vẫn publish, cron
  // refresh sẽ retry sau (14d window).
  let bioEmbedding: number[] | null = null;
  try {
    const text = `${existing.headline}\n${existing.bio}`.slice(0, 8000);
    bioEmbedding = await embedQuery(text);
  } catch (err) {
    console.error('[tutor.publish.embed]', err);
  }

  const [updated] = await db
    .update(tutorProfile)
    .set({
      status: 'PUBLISHED',
      updatedAt: new Date(),
      ...(bioEmbedding
        ? {
            bioEmbedding,
            bioEmbeddingUpdatedAt: new Date(),
          }
        : {}),
    })
    .where(eq(tutorProfile.id, id))
    .returning();

  return NextResponse.json({ tutor: updated });
}
