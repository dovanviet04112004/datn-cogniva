/**
 * POST /api/mastery/decay — forgetting curve cron job.
 *
 * Áp dụng `decay(score, daysSinceSeen)` cho mọi mastery row của TẤT CẢ users
 * mà `decayedAt` < ngày hôm nay (idempotent trong ngày).
 *
 * Triển khai cron:
 *   - Vercel: cron job 02:00 daily → POST endpoint này.
 *   - Local: chạy thủ công khi test.
 *
 * Auth:
 *   - Khi gọi từ Vercel Cron: header `x-cron-secret` khớp `CRON_SECRET` env.
 *   - Khi gọi từ user thường: 401.
 *
 * Trả về số rows được decay.
 */
import { NextResponse } from 'next/server';
import { lt, or, isNull, eq } from 'drizzle-orm';

import { db, mastery as masteryTable } from '@cogniva/db';

import { decay } from '@/lib/mastery/bkt';

export const runtime = 'nodejs';
export const maxDuration = 300; // có thể nhiều rows

const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Hôm nay 00:00 — chỉ decay những row có decayedAt < hôm nay (hoặc NULL)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = await db
    .select()
    .from(masteryTable)
    .where(or(isNull(masteryTable.decayedAt), lt(masteryTable.decayedAt, today)));

  let updated = 0;
  for (const row of rows) {
    if (!row.lastSeenAt) continue; // chưa từng gặp → không decay
    const daysSinceSeen =
      (Date.now() - row.lastSeenAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceSeen <= 0.5) continue; // bỏ qua nếu ôn trong nửa ngày qua

    const newScore = decay(row.score, daysSinceSeen);
    if (Math.abs(newScore - row.score) < 0.001) {
      // Không đổi đáng kể → vẫn đánh dấu decayedAt để khỏi quét lại trong ngày
      await db
        .update(masteryTable)
        .set({ decayedAt: new Date() })
        .where(eq(masteryTable.id, row.id));
      continue;
    }
    await db
      .update(masteryTable)
      .set({ score: newScore, decayedAt: new Date() })
      .where(eq(masteryTable.id, row.id));
    updated++;
  }

  return NextResponse.json({ scanned: rows.length, updated });
}
