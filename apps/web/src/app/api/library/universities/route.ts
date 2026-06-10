/**
 * /api/library/universities — University→Course model (2026-05-27).
 *
 *   GET  ?q=bach+khoa&limit=10  — search university (autocomplete cho upload)
 *   POST { name, shortName? }   — tạo university mới (UGC), dedup theo slug
 *
 * UGC: user gõ tên trường khi upload, không có thì tạo. slug dedup tránh trùng
 * ("ĐH Bách Khoa HN" gõ 2 lần → 1 row). Admin merge biến thể sau.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';

import { db, libraryUniversity } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { slugifyVi } from '@/lib/library/course-util';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(20, parseInt(url.searchParams.get('limit') ?? '10', 10) || 10);

  const rows = await db
    .select({
      id: libraryUniversity.id,
      slug: libraryUniversity.slug,
      name: libraryUniversity.name,
      shortName: libraryUniversity.shortName,
      docCount: libraryUniversity.docCount,
    })
    .from(libraryUniversity)
    .where(
      q.length > 0
        ? or(
            ilike(libraryUniversity.name, `%${q}%`),
            ilike(libraryUniversity.shortName, `%${q}%`),
          )
        : undefined,
    )
    .orderBy(desc(libraryUniversity.docCount))
    .limit(limit);

  return NextResponse.json({ universities: rows });
}

const BODY = z.object({
  name: z.string().min(2).max(160),
  shortName: z.string().max(40).optional(),
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

  // Dedup: reuse nếu slug đã tồn tại
  const [existing] = await db
    .select()
    .from(libraryUniversity)
    .where(eq(libraryUniversity.slug, slug))
    .limit(1);
  if (existing) {
    return NextResponse.json({ university: existing, created: false });
  }

  const [created] = await db
    .insert(libraryUniversity)
    .values({
      slug,
      name: parsed.data.name.trim(),
      shortName: parsed.data.shortName?.trim() || null,
    })
    .returning();

  return NextResponse.json({ university: created, created: true });
}
