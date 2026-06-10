/**
 * getUserAnalytics — tổng hợp usage + cost LLM 30 ngày của 1 user.
 *
 * Logic gốc nằm inline trong GET /api/analytics; tách ra đây làm 1 nguồn duy
 * nhất để CẢ route (mobile vẫn gọi) LẪN trang SSR /analytics dùng chung, không
 * nhân đôi 3 query aggregate. Đọc từ message.metadata JSONB (không store cột
 * aggregate riêng để tránh sync). Server-only (Drizzle) → KHÔNG ở shared.
 */
import { sql } from 'drizzle-orm';

// dbReplica: read thuần (aggregate 30 ngày), không read-your-own-write → route
// sang replica để giảm tải primary. Fallback primary nếu chưa cấu hình replica.
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

/**
 * Bản CACHE (cache-aside, TTL 300s). 3 query aggregate quét `message.metadata`
 * JSONB 30 ngày là read NẶNG nhất hệ → đáng cache nhất. Invalidate qua
 * `onAnalyticsChanged(userId)` khi có ASSISTANT message mới (api/chat). An toàn
 * serialize: AnalyticsData chỉ number/string, KHÔNG field Date.
 */
export async function getUserAnalytics(userId: string): Promise<AnalyticsData> {
  return cached(ck.analytics(userId), 300, () => fetchUserAnalytics(userId));
}

/** Truy vấn thật 3 aggregate — chỉ chạy khi cache MISS. */
async function fetchUserAnalytics(userId: string): Promise<AnalyticsData> {
  // Aggregate 30 ngày
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

  // 7 ngày gần đây, group by day
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

  // Group by model
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
