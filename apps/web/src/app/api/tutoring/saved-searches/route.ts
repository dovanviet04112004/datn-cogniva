/**
 * /api/tutoring/saved-searches — V4 T5 (2026-05-22).
 *
 * GET   — list saved searches của user
 * POST  — lưu search hiện tại (filter snapshot)
 *
 * Spec: docs/plans/tutoring-v4.md §3 T5.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, tutorSavedSearch } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const POST_SCHEMA = z.object({
  name: z.string().min(1).max(60),
  filters: z.object({
    subjectSlug: z.string().optional(),
    level: z.string().optional(),
    budgetMaxVnd: z.number().optional(),
    modality: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  }),
  alertEnabled: z.boolean().optional().default(false),
});

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const items = await db
    .select()
    .from(tutorSavedSearch)
    .where(eq(tutorSavedSearch.userId, session.user.id))
    .orderBy(desc(tutorSavedSearch.createdAt))
    .limit(20);

  return NextResponse.json({ savedSearches: items });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [created] = await db
    .insert(tutorSavedSearch)
    .values({
      userId: session.user.id,
      name: parsed.data.name,
      filters: parsed.data.filters,
      alertEnabled: parsed.data.alertEnabled,
    })
    .returning();

  return NextResponse.json({ savedSearch: created }, { status: 201 });
}
