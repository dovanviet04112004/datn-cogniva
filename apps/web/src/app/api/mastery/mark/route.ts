/**
 * POST /api/mastery/mark — đánh dấu THỦ CÔNG trạng thái học 1 atom (concept).
 *
 * User có thể tự chuyển atom sang "đã nắm" (không cần làm quiz/flashcard) hoặc
 * bỏ đánh dấu (về "chưa học"). Bổ sung cho luồng tự-động (mastery từ attempt).
 *
 * Body: { conceptId: string, mastered: boolean, workspaceId?: string }
 *   - mastered=true  → upsert mastery row, score = MASTERY_MASTERED (đã nắm).
 *   - mastered=false → xoá mastery row (về chưa học).
 *
 * Bust: onMasteryChanged(userId, workspaceId) → atom-list + graph cập nhật ngay.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, mastery } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onMasteryChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

// Score đặt cho từng mức (khớp getMasteryLevel: <0.8=learning, ≥0.8=mastered).
const LEVEL_SCORE = { learning: 0.6, mastered: 0.9 } as const;

const SCHEMA = z.object({
  conceptId: z.string(),
  // 'new' = chưa học (xoá mastery), 'learning' = đang học, 'mastered' = đã nắm.
  level: z.enum(['new', 'learning', 'mastered']),
  workspaceId: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { conceptId, level, workspaceId } = parsed.data;
  const userId = session.user.id;
  const now = new Date();

  if (level === 'new') {
    // Về "chưa học" → xoá mastery row.
    await db
      .delete(mastery)
      .where(and(eq(mastery.userId, userId), eq(mastery.conceptId, conceptId)));
  } else {
    // Đang học / Đã nắm → set score tương ứng.
    const score = LEVEL_SCORE[level];
    const [existing] = await db
      .select({ id: mastery.id })
      .from(mastery)
      .where(and(eq(mastery.userId, userId), eq(mastery.conceptId, conceptId)))
      .limit(1);
    if (existing) {
      await db
        .update(mastery)
        .set({ score, lastSeenAt: now })
        .where(eq(mastery.id, existing.id));
    } else {
      await db.insert(mastery).values({
        userId,
        conceptId,
        score,
        attempts: 0,
        correct: 0,
        lastSeenAt: now,
      });
    }
  }

  await onMasteryChanged(userId, workspaceId, conceptId);
  return NextResponse.json({ ok: true });
}
