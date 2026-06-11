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
import { redirect } from 'next/navigation';
import { TrendingUp } from 'lucide-react';

import { getUserAnalytics } from '@/lib/analytics/get-user-analytics';
import { getServerSession } from '@/lib/auth-server';
import { Card } from '@/components/ui/card';
// Tiêu đề mục dùng chung — thay khối eyebrow gạch + uppercase hardcode cũ.
import { SectionHeading } from '@/components/ui/section-heading';
import { PageShell } from '@/components/layout/page-shell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  // Server Component: fetch aggregate thẳng DB qua lib dùng chung với route
  // /api/analytics (mobile vẫn gọi route) → HTML có data ngay, không skeleton.
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/analytics');
  const data = await getUserAnalytics(session.user.id);

  const maxCost = Math.max(...data.last7Days.map((d) => d.costUsd), 0.0001);

  return (
    <PageShell
      // Trang OVERVIEW báo cáo — bật hero banner aurora dùng chung.
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
          <code className="rounded bg-muted px-1 text-xs">message.metadata</code>{' '}
          mỗi lần chat hoàn thành.
        </>
      }
    >

      {/* ── Stat tiles ───────────────────────────────
          Premium: 1 unified surface chia 4 cột với divider — pattern
          Linear/Stripe. Mỗi tile có accent dot riêng + sparkline trend
          nếu data có (last7Days). */}
      <Card className="grid grid-cols-2 overflow-hidden rounded-xl border-divider shadow-soft sm:grid-cols-4 sm:divide-x sm:divide-divider">
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

      {/* ── 7-day chart — soft tinted bars với gradient ───── */}
      <Card className="rounded-xl border-divider p-5 shadow-soft">
        {/* Tiêu đề mục dùng chung; count="7d" (cửa sổ 7 ngày), action = max cost.
            max-cost giữ font-mono vì là giá trị kỹ thuật nhỏ (text-xs). */}
        <SectionHeading
          count="7d"
          action={
            <span className="font-mono text-xs tabular-nums text-text-muted">
              max ${maxCost.toFixed(4)}
            </span>
          }
        >
          Cost theo ngày
        </SectionHeading>

        {data.last7Days.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-surface-secondary/40 py-8 text-center text-xs text-muted-foreground">
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
                      className="w-full rounded-md bg-gradient-to-t from-primary/40 to-primary/80 shadow-soft transition-all duration-base ease-expo-out group-hover/bar:from-primary/60 group-hover/bar:to-primary"
                      style={{ height: `${Math.max(2, heightPct)}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] tabular-nums text-text-muted">
                    {d.date.slice(5)}
                  </span>
                  {/* Cỡ chữ sàn 10px (cột bar hẹp, 11px vỡ layout) — bỏ cỡ lẻ 10.5px */}
                  <span className="font-mono text-[10px] font-semibold tabular-nums">
                    ${d.costUsd.toFixed(4)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── byModel table — premium row design ─────────── */}
      <Card className="rounded-xl border-divider p-5 shadow-soft">
        {/* Tiêu đề mục dùng chung — count = số model. */}
        <SectionHeading count={data.byModel.length}>Theo model</SectionHeading>
        {data.byModel.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-surface-secondary/40 py-8 text-center text-xs text-muted-foreground">
            Chưa có data.
          </p>
        ) : (
          <table className="w-full text-sm">
            {/* Header bảng = eyebrow label → chuẩn hoá text-[11px] (bỏ cỡ lẻ 10.5px) */}
            <thead className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              <tr className="border-b border-divider">
                <th className="py-2.5 text-left font-semibold">Model</th>
                <th className="py-2.5 text-right font-semibold">Messages</th>
                <th className="py-2.5 text-right font-semibold">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {data.byModel.map((m) => (
                <tr
                  key={m.model}
                  className="border-b border-divider last:border-0 transition-colors hover:bg-muted/40"
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

/**
 * StatTile — 1 cột trong unified stat card. Accent dot bên cạnh label +
 * value to (sans Geist, tabular-nums) + sparkline mini nếu có data.
 */
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
        {/* Eyebrow label của StatTile → chuẩn hoá text-[11px] (bỏ cỡ lẻ 10.5px) */}
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
      </div>
      <div className="space-y-1.5">
        {/* Số metric to: dùng sans Geist (bỏ font-mono), giữ tabular-nums canh cột. */}
        <p className="text-2xl font-semibold tabular-nums leading-none tracking-tight">
          {value}
        </p>
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
