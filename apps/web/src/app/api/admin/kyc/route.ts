/**
 * GET /api/admin/kyc — admin queue: list KYC documents PENDING.
 *
 * Group theo tutor để dễ review batch. Filter ?status=PENDING|APPROVED|REJECTED
 * (default PENDING). Trả về tutors mới nhất trước.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';

import {
  db,
  tutorKycDocument,
  tutorProfile,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin/guard';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'PENDING';

  // List tutor có ít nhất 1 doc với status filter
  const rows = await db
    .select({
      tutorId: tutorProfile.id,
      tutorUserId: tutorProfile.userId,
      tutorName: userTable.name,
      tutorEmail: userTable.email,
      tutorAvatarUrl: tutorProfile.avatarUrl,
      headline: tutorProfile.headline,
      verificationStatus: tutorProfile.verificationStatus,
      docCount: sql<number>`COUNT(${tutorKycDocument.id})::int`,
      pendingCount: sql<number>`COUNT(CASE WHEN ${tutorKycDocument.status} = 'PENDING' THEN 1 END)::int`,
      latestUpload: sql<string>`MAX(${tutorKycDocument.createdAt})`,
    })
    .from(tutorKycDocument)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutorKycDocument.tutorId))
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(eq(tutorKycDocument.status, status))
    .groupBy(
      tutorProfile.id,
      tutorProfile.userId,
      userTable.name,
      userTable.email,
      tutorProfile.avatarUrl,
      tutorProfile.headline,
      tutorProfile.verificationStatus,
    )
    .orderBy(desc(sql`MAX(${tutorKycDocument.createdAt})`))
    .limit(50);

  return NextResponse.json({ tutors: rows });
}
