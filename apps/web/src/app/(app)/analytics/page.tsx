import { redirect } from 'next/navigation';
import { TrendingUp } from 'lucide-react';

import { apiServer } from '@/lib/api-server';
import { getServerSession } from '@/lib/auth-server';
import { Card } from '@/components/ui/card';
import { SectionHeading } from '@/components/ui/section-heading';
import { PageShell } from '@/components/layout/page-shell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnalyticsData = {
  totalMessages: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  last7Days: Array<{ date: string; messages: number; costUsd: number }>;
  byModel: Array<{ model: string; messages: number; costUsd: number }>;
};

export default async function AnalyticsPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/analytics');
  const data = await apiServer<AnalyticsData>('/api/analytics');

  const maxCost = Math.max(...data.last7Days.map((d) => d.costUsd), 0.0001);

  return (
    <PageShell
      hero
      eyebrow="Phân tích"
      eyebrowIcon={TrendingUp}
      title={
        <span className="flex items-center gap-2">
          <TrendingUp className="h-6 w-6" />
          Analytics
        </span>
      }
      description={
        <>
          Báo cáo sử dụng + chi phí LLM 30 ngày qua. Lưu vào{' '}
          <code className="bg-muted rounded px-1 text-xs">message.metadata</code> mỗi lần chat hoàn
          thành.
        </>
      }
    >
      <Card className="border-divider shadow-soft sm:divide-divider grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-4 sm:divide-x">
        <StatTile
          accent="bg-blue-500"
          label="Messages"
          value={data.totalMessages.toLocaleString('vi-VN')}
          sparkline={data.last7Days.map((d) => d.messages)}
        />
        <StatTile
          accent="bg-emerald-500"
          label="Prompt tokens"
          value={data.totalPromptTokens.toLocaleString('vi-VN')}
          sparkline={null}
        />
        <StatTile
          accent="bg-discovery-500"
          label="Completion tokens"
          value={data.totalCompletionTokens.toLocaleString('vi-VN')}
          sparkline={null}
        />
        <StatTile
          accent="bg-orange-500"
          label="Cost (USD)"
          value={`$${data.totalCostUsd.toFixed(4)}`}
          sparkline={data.last7Days.map((d) => d.costUsd)}
        />
      </Card>

      <Card className="border-divider shadow-soft rounded-xl p-5">
        <SectionHeading
          count="7d"
          action={
            <span className="text-text-muted font-mono text-xs tabular-nums">
              max ${maxCost.toFixed(4)}
            </span>
          }
        >
          Cost theo ngày
        </SectionHeading>

        {data.last7Days.length === 0 ? (
          <p className="bg-surface-secondary/40 text-muted-foreground rounded-lg border border-dashed py-8 text-center text-xs">
            Chưa có data — chat thử để thấy biểu đồ.
          </p>
        ) : (
          <div className="flex h-44 items-end gap-2">
            {data.last7Days.map((d) => {
              const heightPct = (d.costUsd / maxCost) * 100;
              return (
                <div
                  key={d.date}
                  className="group/bar flex flex-1 flex-col items-center gap-1.5"
                  title={`${d.date}: $${d.costUsd.toFixed(4)} · ${d.messages} msg`}
                >
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="from-primary/40 to-primary/80 shadow-soft duration-base ease-expo-out group-hover/bar:from-primary/60 group-hover/bar:to-primary w-full rounded-md bg-gradient-to-t transition-all"
                      style={{ height: `${Math.max(2, heightPct)}%` }}
                    />
                  </div>
                  <span className="text-text-muted font-mono text-[10px] tabular-nums">
                    {d.date.slice(5)}
                  </span>
                  <span className="font-mono text-[10px] font-semibold tabular-nums">
                    ${d.costUsd.toFixed(4)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="border-divider shadow-soft rounded-xl p-5">
        <SectionHeading count={data.byModel.length}>Theo model</SectionHeading>
        {data.byModel.length === 0 ? (
          <p className="bg-surface-secondary/40 text-muted-foreground rounded-lg border border-dashed py-8 text-center text-xs">
            Chưa có data.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-text-muted text-[11px] font-semibold uppercase tracking-[0.14em]">
              <tr className="border-divider border-b">
                <th className="py-2.5 text-left font-semibold">Model</th>
                <th className="py-2.5 text-right font-semibold">Messages</th>
                <th className="py-2.5 text-right font-semibold">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {data.byModel.map((m) => (
                <tr
                  key={m.model}
                  className="border-divider hover:bg-muted/40 border-b transition-colors last:border-0"
                >
                  <td className="py-3 font-mono text-xs">{m.model}</td>
                  <td className="py-3 text-right font-mono tabular-nums">
                    {m.messages.toLocaleString('vi-VN')}
                  </td>
                  <td className="py-3 text-right font-mono font-semibold tabular-nums">
                    ${m.costUsd.toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PageShell>
  );
}

function StatTile({
  accent,
  label,
  value,
  sparkline,
}: {
  accent: string;
  label: string;
  value: string;
  sparkline: number[] | null;
}) {
  const max = sparkline ? Math.max(...sparkline, 0.0001) : 0;
  return (
    <div className="flex flex-col justify-between gap-2 px-5 py-4">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${accent}`} />
        <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-2xl font-semibold tabular-nums leading-none tracking-tight">{value}</p>
        {sparkline && sparkline.length > 0 && (
          <div className="flex h-4 items-end gap-0.5">
            {sparkline.map((v, i) => (
              <div
                key={i}
                className={`flex-1 rounded-sm ${accent} opacity-30`}
                style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
