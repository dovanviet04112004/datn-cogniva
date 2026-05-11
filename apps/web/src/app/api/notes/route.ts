/**
 * /api/notes — list (GET) + create (POST).
 *
 * GET ?limit=50&offset=0  → list note của user, order updated_at DESC.
 * POST body { title, content, conceptId?, documentId? }  → tạo note.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, note } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { awardXp, XP_AMOUNTS } from '@/lib/gamification/xp';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

  const rows = await db
    .select({
      id: note.id,
      title: note.title,
      content: note.content,
      conceptId: note.conceptId,
      documentId: note.documentId,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })
    .from(note)
    .where(eq(note.userId, session.user.id))
    .orderBy(desc(note.updatedAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({ notes: rows });
}

const CREATE_SCHEMA = z.object({
  title: z.string().min(1).max(200).default('Untitled'),
  content: z.string().default(''),
  conceptId: z.string().optional(),
  documentId: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [inserted] = await db
    .insert(note)
    .values({
      userId: session.user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      conceptId: parsed.data.conceptId ?? null,
      documentId: parsed.data.documentId ?? null,
    })
    .returning();

  // Gamification: +3 XP cho mỗi note tạo mới + check achievement first_note
  await awardXp(session.user.id, XP_AMOUNTS.NOTE_CREATE, {
    source: 'note',
    totalCount: 1,
  });

  return NextResponse.json({ note: inserted }, { status: 201 });
}
