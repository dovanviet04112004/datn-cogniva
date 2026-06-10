/**
 * /api/library/courses — University→Course model (2026-05-27).
 *
 *   GET  ?q=&universityId=&limit=  — search course (autocomplete). Lọc theo
 *        university nếu có; general courses (university=null) luôn match khi
 *        không truyền universityId.
 *   POST { name, code?, universityId? }  — tạo course (UGC), dedup theo
 *        (university, slug).
 */
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { db, libraryCourse, libraryUniversity } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { slugifyVi } from '@/lib/library/course-util';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const universityId = url.searchParams.get('universityId')?.trim() || null;
  const limit = Math.min(20, parseInt(url.searchParams.get('limit') ?? '10', 10) || 10);

  const conds = [];
  if (q.length > 0) {
    conds.push(
      or(ilike(libraryCourse.name, `%${q}%`), ilike(libraryCourse.code, `%${q}%`))!,
    );
  }
  if (universityId) {
    // Course của trường + course general (dùng được cho mọi trường)
    conds.push(
      or(eq(libraryCourse.universityId, universityId), isNull(libraryCourse.universityId))!,
    );
  }

  const rows = await db
    .select({
      id: libraryCourse.id,
      name: libraryCourse.name,
      code: libraryCourse.code,
      universityId: libraryCourse.universityId,
      universityName: libraryUniversity.name,
      universityShort: libraryUniversity.shortName,
      docCount: libraryCourse.docCount,
    })
    .from(libraryCourse)
    .leftJoin(libraryUniversity, eq(libraryUniversity.id, libraryCourse.universityId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(libraryCourse.docCount))
    .limit(limit);

  return NextResponse.json({ courses: rows });
}

const BODY = z.object({
  name: z.string().min(2).max(160),
  code: z.string().max(40).optional(),
  universityId: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = BODY.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const slug = slugifyVi(parsed.data.name);
  if (!slug) return NextResponse.json({ error: 'Tên không hợp lệ' }, { status: 400 });

  const universityId = parsed.data.universityId || null;

  // Verify university tồn tại nếu truyền
  if (universityId) {
    const [u] = await db
      .select({ id: libraryUniversity.id })
      .from(libraryUniversity)
      .where(eq(libraryUniversity.id, universityId))
      .limit(1);
    if (!u) return NextResponse.json({ error: 'University không tồn tại' }, { status: 400 });
  }

  // Dedup: (coalesce(university,''), slug) unique
  const [existing] = await db
    .select()
    .from(libraryCourse)
    .where(
      and(
        universityId
          ? eq(libraryCourse.universityId, universityId)
          : isNull(libraryCourse.universityId),
        eq(libraryCourse.slug, slug),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json({ course: existing, created: false });
  }

  const [created] = await db
    .insert(libraryCourse)
    .values({
      id: randomUUID(),
      universityId,
      code: parsed.data.code?.trim() || null,
      name: parsed.data.name.trim(),
      slug,
      createdBy: session.user.id,
    })
    .returning();

  return NextResponse.json({ course: created, created: true });
}
