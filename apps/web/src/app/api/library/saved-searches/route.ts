/**
 * /api/library/saved-searches — Phase 4 saved search bookmarks.
 *
 *   GET    — list user's saved searches
 *   POST   — create new saved search
 *
 * Body POST: { name, queryParams: {...}, notifyOnNew?: boolean }
 */
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, librarySavedSearch } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const BODY = z.object({
  name: z.string().min(2).max(80),
  queryParams: z.record(z.union([z.string(), z.number(), z.array(z.string())])),
  notifyOnNew: z.boolean().optional().default(false),
});

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select()
    .from(librarySavedSearch)
    .where(eq(librarySavedSearch.userId, session.user.id))
    .orderBy(desc(librarySavedSearch.createdAt));

  return NextResponse.json({ savedSearches: rows });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const id = randomUUID();
  await db.insert(librarySavedSearch).values({
    id,
    userId: session.user.id,
    name: parsed.data.name,
    queryParams: parsed.data.queryParams,
    notifyOnNew: parsed.data.notifyOnNew,
  });

  return NextResponse.json({ ok: true, id });
}
