/**
 * /analytics — báo cáo cost LLM + usage 30 ngày của user.
 *
 * Lấy data từ `/api/analytics` (Phase 10). Hiển thị:
 *   1. 4 stat card: tổng messages / prompt tokens / completion tokens / cost USD
 *   2. Bar chart 7 ngày gần đây (cost USD/ngày) — SVG thuần, không thư viện
 *   3. Bảng cost theo từng model (Claude Sonnet/Haiku/Opus, Gemini, Voyage)
 *
 * Phase 10 API đã giới hạn 30 ngày; UI render rỗng nếu user chưa chat.
 */
'use client';

import * as React from 'react';
import { Coins, Cpu, MessageSquare, TrendingUp } from 'lucide-react';

import { Card } from '@/components/ui/card';

type AnalyticsData = {
  totalMessages: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  last7Days: Array<{ date: string; messages: number; costUsd: number }>;
  byModel: Array<{ model: string; messages: number; costUsd: number }>;
};

export default function AnalyticsPage() {
  const [data, setData] = React.useState<AnalyticsData | null>(null);

  React.useEffect(() => {
    fetch('/api/analytics')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return <p className="p-6 text-sm text-muted-foreground">Đang tải...</p>;
  }

  const maxCost = Math.max(...data.last7Days.map((d) => d.costUsd), 0.0001);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <TrendingUp className="h-6 w-6" />
          Analytics
        </h1>
        <p className="text-sm text-muted-foreground">
          Báo cáo sử dụng + chi phí LLM 30 ngày qua. Lưu vào{' '}
          <code className="rounded bg-muted px-1 text-xs">message.metadata</code>{' '}
          mỗi lần chat hoàn thành.
        </p>
      </div>

      {/* ── Stat cards ──────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={MessageSquare}
          label="Messages"
          value={data.totalMessages.toLocaleString('vi-VN')}
        />
        <StatCard
          icon={Cpu}
          label="Prompt tokens"
          value={data.totalPromptTokens.toLocaleString('vi-VN')}
        />
        <StatCard
          icon={Cpu}
          label="Completion tokens"
          value={data.totalCompletionTokens.toLocaleString('vi-VN')}
        />
        <StatCard
          icon={Coins}
          label="Cost (USD)"
          value={`$${data.totalCostUsd.toFixed(4)}`}
        />
      </div>

      {/* ── 7-day chart ─────────────────────────────── */}
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Cost theo ngày (7 ngày)</h2>
        {data.last7Days.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Chưa có data — chat thử để thấy biểu đồ.
          </p>
        ) : (
          <div className="flex h-40 items-end gap-2">
            {data.last7Days.map((d) => {
              const heightPct = (d.costUsd / maxCost) * 100;
              return (
                <div
                  key={d.date}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${d.date}: $${d.costUsd.toFixed(4)} · ${d.messages} msg`}
                >
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t bg-primary/70 transition-all"
                      style={{ height: `${Math.max(2, heightPct)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {d.date.slice(5)}
                  </span>
                  <span className="text-[10px] font-medium tabular-nums">
                    ${d.costUsd.toFixed(4)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── byModel table ───────────────────────────── */}
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Theo model</h2>
        {data.byModel.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Chưa có data.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left">Model</th>
                <th className="py-2 text-right">Messages</th>
                <th className="py-2 text-right">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {data.byModel.map((m) => (
                <tr key={m.model} className="border-b last:border-0">
                  <td className="py-2 font-mono text-xs">{m.model}</td>
                  <td className="py-2 text-right tabular-nums">
                    {m.messages.toLocaleString('vi-VN')}
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">
                    ${m.costUsd.toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: string;
}) {
  return (
    <Card className="space-y-1 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </Card>
  );
}
