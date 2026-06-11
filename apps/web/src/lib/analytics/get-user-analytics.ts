import { sql } from 'drizzle-orm';

import { dbReplica } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export type AnalyticsData = {
  totalMessages: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  last7Days: Array<{ date: string; messages: number; costUsd: number }>;
  byModel: Array<{ model: string; messages: number; costUsd: number }>;
};

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

export async function getUserAnalytics(userId: string): Promise<AnalyticsData> {
  return cached(ck.analytics(userId), 300, () => fetchUserAnalytics(userId));
}

async function fetchUserAnalytics(userId: string): Promise<AnalyticsData> {
  const aggRows = await dbReplica.execute<AggRow>(sql`
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

  const days = await dbReplica.execute<DayRow>(sql`
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

  const byModel = await dbReplica.execute<ModelRow>(sql`
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

  return {
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
  };
}
