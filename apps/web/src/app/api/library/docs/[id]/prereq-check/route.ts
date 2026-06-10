/**
 * GET /api/library/docs/[id]/prereq-check — Bonus #13 (Phase 3).
 *
 * Trả về list prerequisite atoms user CHƯA master để cảnh báo trước khi
 * import/đọc doc. Nếu không login → trả full prereq list (no mastery filter).
 *
 * Response:
 *   {
 *     prereqs: string[],              // toàn bộ prereq của doc
 *     missing: string[],              // prereq user chưa có (logged-in only)
 *     hasGap: boolean
 *   }
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db, libraryDoc } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { findMissingPrereqs } from '@/lib/library/difficulty-prereq';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  const [doc] = await db
    .select({
      prereqSlugs: libraryDoc.prerequisiteAtomSlugs,
      difficulty: libraryDoc.difficulty,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const prereqs = doc.prereqSlugs ?? [];
  if (prereqs.length === 0) {
    return NextResponse.json({
      prereqs: [],
      missing: [],
      hasGap: false,
      difficulty: doc.difficulty,
    });
  }

  let missing: string[] = [];
  if (session?.user.id) {
    missing = await findMissingPrereqs(id, session.user.id);
  }

  return NextResponse.json({
    prereqs,
    missing,
    hasGap: missing.length > 0,
    difficulty: doc.difficulty,
  });
}
