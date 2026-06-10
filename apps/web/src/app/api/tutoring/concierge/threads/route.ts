/**
 * /api/tutoring/concierge/threads — V4 T1 (2026-05-22).
 *
 * GET   — list threads của user (sort theo last_message_at DESC, limit 20)
 * POST  — tạo thread mới (title NULL, sẽ auto-gen sau message đầu)
 *
 * Spec: docs/plans/tutoring-v4.md §3 T1.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';

import { db, tutoringConciergeThread } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const MAX_THREADS = 20;

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const threads = await db
    .select({
      id: tutoringConciergeThread.id,
      title: tutoringConciergeThread.title,
      lastMessageAt: tutoringConciergeThread.lastMessageAt,
      extractedFilters: tutoringConciergeThread.extractedFilters,
      createdAt: tutoringConciergeThread.createdAt,
    })
    .from(tutoringConciergeThread)
    .where(eq(tutoringConciergeThread.userId, session.user.id))
    .orderBy(desc(tutoringConciergeThread.lastMessageAt))
    .limit(MAX_THREADS);

  return NextResponse.json({ threads });
}

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [thread] = await db
    .insert(tutoringConciergeThread)
    .values({
      userId: session.user.id,
    })
    .returning();

  return NextResponse.json({ thread }, { status: 201 });
}
