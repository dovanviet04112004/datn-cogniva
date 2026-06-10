/**
 * GET /api/flashcards/queue — danh sách cards đến hạn ôn (due <= NOW).
 *
 * Query daily review queue, sắp xếp:
 *   1. NEW cards trước (giới thiệu mới)
 *   2. RELEARNING (lapses cần củng cố)
 *   3. LEARNING (đang trong giai đoạn học)
 *   4. REVIEW (review chính)
 *
 * Default limit 20 — Anki recommend 20 cards/session để tránh burnout.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { db, flashcard, sql } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);
  // V5 (atom-centric): scope theo workspace nếu được pass, cho phép
  // FlashcardSession recipe trong workspace notebook chỉ review thẻ
  // thuộc workspace đó.
  const workspaceId = url.searchParams.get('workspaceId');

  // Custom ORDER BY: ưu tiên NEW > RELEARNING > LEARNING > REVIEW, sau đó due asc
  const rows = await db.execute<typeof flashcard.$inferSelect>(sql`
    SELECT *
    FROM flashcard
    WHERE user_id = ${session.user.id}
      AND due <= NOW()
      ${workspaceId ? sql`AND workspace_id = ${workspaceId}` : sql``}
    ORDER BY
      CASE state
        WHEN 'NEW' THEN 1
        WHEN 'RELEARNING' THEN 2
        WHEN 'LEARNING' THEN 3
        WHEN 'REVIEW' THEN 4
      END,
      due ASC
    LIMIT ${limit};
  `);

  return NextResponse.json({ flashcards: rows });
}
