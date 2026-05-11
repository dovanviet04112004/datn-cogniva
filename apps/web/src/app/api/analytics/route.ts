/**
 * GET /api/analytics — aggregate usage + cost cho user hiện tại.
 *
 * Output:
 *   {
 *     totalMessages: N,
 *     totalPromptTokens: N,
 *     totalCompletionTokens: N,
 *     totalCostUsd: 0.xxx,
 *     last7Days: [{ date, messages, costUsd }],
 *     byModel: { 'claude-sonnet-4-6': { messages, costUsd } }
 *   }
 *
 * Đọc từ message.metadata JSONB — KHÔNG store aggregate cột riêng để
 * tránh sync. Truy vấn trong 30 ngày gần nhất để tránh full scan.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { db } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type AggRow = {
  total_messages: number;
  total_prompt: number;
  total_completion: number;
  total_cost: string;
};

type DayRow = {
  day: string;
  messages: number;
  cost: string;
};

type ModelRow = {
  model: string;
  messages: number;
  cost: string;
};

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  // Aggregate 30 ngày
  const aggRows = await db.execute<AggRow>(sql`
    SELECT
      count(*)::int AS total_messages,
      coalesce(sum((metadata->>'promptTokens')::int), 0)::int AS total_prompt,
      coalesce(sum((metadata->>'completionTokens')::int), 0)::int AS total_completion,
      coalesce(sum((metadata->>'costUsd')::numeric), 0)::text AS total_cost
    FROM message m
    INNER JOIN conversation c ON c.id = m.conversation_id
    WHERE c.user_id = ${userId}
      AND m.role = 'ASSISTANT'
      AND m.created_at > now() - interval '30 days';
  `);
  const agg = aggRows[0] ?? {
    total_messages: 0,
    total_prompt: 0,
    total_completion: 0,
    total_cost: '0',
  };

  // 7 ngày gần đây, group by day
  const days = await db.execute<DayRow>(sql`
    SELECT
      to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      count(*)::int AS messages,
      coalesce(sum((metadata->>'costUsd')::numeric), 0)::text AS cost
    FROM message m
    INNER JOIN conversation c ON c.id = m.conversation_id
    WHERE c.user_id = ${userId}
      AND m.role = 'ASSISTANT'
      AND m.created_at > now() - interval '7 days'
    GROUP BY day
    ORDER BY day ASC;
  `);

  // Group by model
  const byModel = await db.execute<ModelRow>(sql`
    SELECT
      coalesce(metadata->>'model', 'unknown') AS model,
      count(*)::int AS messages,
      coalesce(sum((metadata->>'costUsd')::numeric), 0)::text AS cost
    FROM message m
    INNER JOIN conversation c ON c.id = m.conversation_id
    WHERE c.user_id = ${userId}
      AND m.role = 'ASSISTANT'
      AND m.created_at > now() - interval '30 days'
    GROUP BY model
    ORDER BY cost DESC;
  `);

  return NextResponse.json({
    totalMessages: Number(agg.total_messages),
    totalPromptTokens: Number(agg.total_prompt),
    totalCompletionTokens: Number(agg.total_completion),
    totalCostUsd: Number(agg.total_cost),
    last7Days: days.map((d) => ({
      date: d.day,
      messages: Number(d.messages),
      costUsd: Number(d.cost),
    })),
    byModel: byModel.map((m) => ({
      model: m.model,
      messages: Number(m.messages),
      costUsd: Number(m.cost),
    })),
  });
}
