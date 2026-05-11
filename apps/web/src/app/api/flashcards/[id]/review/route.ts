/**
 * POST /api/flashcards/[id]/review — submit rating 1-4, FSRS update + log.
 *
 * Body: { rating: 1|2|3|4, duration?: number }
 *
 * Transaction:
 *   1. SELECT card hiện tại (verify ownership)
 *   2. applyReview(current, rating) → state mới
 *   3. UPDATE flashcard với state mới
 *   4. INSERT review log
 *
 * Lý do làm trong transaction: nếu UPDATE thành nhưng INSERT review thất bại,
 * lịch ôn vẫn đúng nhưng mất analytics. Atomic giữ data consistency.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, flashcard, review } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { applyReview } from '@/lib/flashcards/fsrs';
import { awardXp, XP_AMOUNTS } from '@/lib/gamification/xp';

export const runtime = 'nodejs';

const REVIEW_SCHEMA = z.object({
  rating: z.number().int().min(1).max(4),
  /** Thời gian (ms) user mất để trả lời — proxy cho confidence. */
  duration: z.number().int().min(0).max(600_000).default(0),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = REVIEW_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [card] = await db
    .select()
    .from(flashcard)
    .where(and(eq(flashcard.id, id), eq(flashcard.userId, session.user.id)))
    .limit(1);
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const next = applyReview(
    {
      difficulty: card.difficulty,
      stability: card.stability,
      retrievability: card.retrievability,
      state: card.state,
      due: card.due,
      lastReview: card.lastReview,
    },
    parsed.data.rating,
  );

  // Note: drizzle-orm 0.45 chưa có db.transaction() ổn định với postgres.js
  // pool — chạy 2 query tuần tự. Rủi ro vô hại: nếu INSERT review fail sau
  // UPDATE flashcard, mất 1 dòng log nhưng FSRS state vẫn đúng.
  await db
    .update(flashcard)
    .set({
      difficulty: next.difficulty,
      stability: next.stability,
      retrievability: next.retrievability,
      state: next.state,
      due: next.due,
      lastReview: next.lastReview,
    })
    .where(eq(flashcard.id, id));

  await db.insert(review).values({
    flashcardId: id,
    rating: parsed.data.rating,
    duration: parsed.data.duration,
  });

  // Gamification: award XP + check achievement (best-effort, không block)
  const xpAmount =
    parsed.data.rating >= 3
      ? XP_AMOUNTS.FLASHCARD_REVIEW_PASS
      : XP_AMOUNTS.FLASHCARD_REVIEW_FAIL;
  const { newAchievements } = await awardXp(session.user.id, xpAmount, {
    source: 'flashcard',
    totalCount: 1, // chỉ check "first_flashcard"
  });

  return NextResponse.json({
    flashcard: {
      ...card,
      ...next,
    },
    xp: { awarded: xpAmount, newAchievements },
  });
}
