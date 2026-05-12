/**
 * POST /api/flashcards/generate — AI sinh cards từ chunks.
 *
 * Body:
 *   { documentId?: string, chunkIds?: string[], type: 'BASIC'|'CLOZE', limit?: number }
 *
 * Logic:
 *   1. Resolve chunks: nếu chunkIds → load by ids; nếu documentId → load all
 *      chunks của doc. Verify user.id qua join document.
 *   2. Slice theo limit (default 10 chunks, max 50).
 *   3. Với mỗi chunk → generateBasicCards hoặc generateClozeCards.
 *   4. INSERT all cards vào DB với FSRS init.
 *   5. Trả số cards đã tạo.
 *
 * Best-effort: 1 chunk fail không crash batch (extractor đã catch nội bộ).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { chunk, db, document, flashcard } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { generateBasicCards, generateClozeCards } from '@/lib/flashcards/generate';
import { initFsrsFields } from '@/lib/flashcards/fsrs';
import { checkLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const GENERATE_SCHEMA = z.object({
  documentId: z.string().optional(),
  chunkIds: z.array(z.string()).optional(),
  type: z.enum(['BASIC', 'CLOZE']).default('BASIC'),
  limit: z.number().int().min(1).max(50).default(10),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = await checkLimit(`aigen:${session.user.id}`, 'aiGenerate');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = GENERATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { documentId, chunkIds, type, limit } = parsed.data;
  if (!documentId && (!chunkIds || chunkIds.length === 0)) {
    return NextResponse.json(
      { error: 'Cần cung cấp documentId hoặc chunkIds' },
      { status: 400 },
    );
  }

  // Resolve chunks + verify user ownership qua join document
  const baseQuery = db
    .select({ id: chunk.id, content: chunk.content })
    .from(chunk)
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(
      and(
        eq(document.userId, session.user.id),
        documentId ? eq(chunk.documentId, documentId) : inArray(chunk.id, chunkIds ?? []),
      ),
    )
    .limit(limit);

  const chunks = await baseQuery;
  if (chunks.length === 0) {
    return NextResponse.json({ created: 0, cards: [] });
  }

  // Generate tuần tự (free model rate limit) — collect tất cả cards
  const allCards: { type: 'BASIC' | 'CLOZE'; front: string; back: string; sourceChunkId: string }[] = [];
  for (const ch of chunks) {
    const generator = type === 'BASIC' ? generateBasicCards : generateClozeCards;
    const cards = await generator(ch.content);
    for (const c of cards) {
      if (c.type === 'BASIC') {
        allCards.push({ type: 'BASIC', front: c.front, back: c.back, sourceChunkId: ch.id });
      } else {
        // CLOZE: lưu cloze syntax vào front, back rỗng (cloze tự sinh)
        allCards.push({ type: 'CLOZE', front: c.text, back: '', sourceChunkId: ch.id });
      }
    }
  }

  if (allCards.length === 0) {
    return NextResponse.json({ created: 0, cards: [] });
  }

  const fsrs = initFsrsFields();
  const inserted = await db
    .insert(flashcard)
    .values(
      allCards.map((c) => ({
        userId: session.user.id,
        front: c.front,
        back: c.back,
        cardType: c.type,
        sourceChunkId: c.sourceChunkId,
        ...fsrs,
      })),
    )
    .returning();

  return NextResponse.json({ created: inserted.length, cards: inserted });
}
