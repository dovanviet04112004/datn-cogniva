/**
 * /api/flashcards — list (GET) + create thủ công (POST).
 *
 * GET ?state=NEW|LEARNING|REVIEW|RELEARNING&limit=50&offset=0
 *   List flashcards của user, filter optional theo state, paginate.
 *
 * POST body: { cardType, front, back, conceptId?, sourceChunkId? }
 *   Tạo card mới, state mặc định NEW, due ngay (xuất hiện queue lần kế).
 *
 * Bảo mật: scope theo session.user.id qua flashcard.userId (column trực tiếp).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, flashcard } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { initFsrsFields } from '@/lib/flashcards/fsrs';

export const runtime = 'nodejs';

const STATES = ['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'] as const;

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

  const filters = [eq(flashcard.userId, session.user.id)];
  if (state && (STATES as readonly string[]).includes(state)) {
    filters.push(eq(flashcard.state, state as (typeof STATES)[number]));
  }

  const rows = await db
    .select()
    .from(flashcard)
    .where(and(...filters))
    .orderBy(desc(flashcard.due))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({ flashcards: rows });
}

const CREATE_SCHEMA = z.object({
  cardType: z.enum(['BASIC', 'CLOZE', 'IMAGE_OCCLUSION']),
  front: z.string().min(1).max(5000),
  back: z.string().min(1).max(10000),
  conceptId: z.string().optional(),
  sourceChunkId: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const fsrs = initFsrsFields();
  const [inserted] = await db
    .insert(flashcard)
    .values({
      userId: session.user.id,
      conceptId: parsed.data.conceptId ?? null,
      sourceChunkId: parsed.data.sourceChunkId ?? null,
      front: parsed.data.front,
      back: parsed.data.back,
      cardType: parsed.data.cardType,
      ...fsrs,
    })
    .returning();

  return NextResponse.json({ flashcard: inserted }, { status: 201 });
}
