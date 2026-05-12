/**
 * AI Usage Card — hiển thị quota AI hôm nay cho user.
 *
 * Plan v2 §15.1 W6 — visibility cho cost guardrail.
 *
 * UI:
 *   - Progress bar: spent / quota theo plan
 *   - Color: green < 70%, yellow 70-90%, red > 90%
 *   - Reset time (00:00 UTC kế)
 *   - Upgrade CTA nếu FREE và spent > 50%
 *
 * Data nguồn: GET /api/account/usage (Stage 1 W2).
 */
'use client';

import * as React from 'react';
import { Loader2, Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Usage = {
  plan: 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';
  spentUsd: number;
  quotaUsd: number;
  remainingUsd: number;
  spentPct: number;
  resetAt: string;
};

export function AiUsageCard() {
  const [usage, setUsage] = React.useState<Usage | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/account/usage')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Usage) => setUsage(d))
      .catch((err) => setError(err.message));
    // Poll mỗi 30s — quota update tương đối realtime sau mỗi AI call
    const id = setInterval(() => {
      fetch('/api/account/usage')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Usage | null) => d && setUsage(d))
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <Card className="p-4">
        <p className="text-sm text-destructive">Không tải được quota: {error}</p>
      </Card>
    );
  }

  if (!usage) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải quota AI...
        </div>
      </Card>
    );
  }

  // Color theo mức tiêu thụ
  const barColor =
    usage.spentPct >= 90
      ? 'bg-red-500'
      : usage.spentPct >= 70
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  const resetDate = new Date(usage.resetAt);
  const hoursUntilReset = Math.max(
    0,
    Math.round((resetDate.getTime() - Date.now()) / (1000 * 60 * 60)),
  );

  const showUpgradeCTA = usage.plan === 'FREE' && usage.spentPct > 50;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Quota AI hôm nay</h3>
        </div>
        <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium uppercase">
          {usage.plan}
        </span>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-sm">
            ${usage.spentUsd.toFixed(4)}
            <span className="text-muted-foreground"> / ${usage.quotaUsd.toFixed(2)}</span>
          </span>
          <span
            className={cn(
              'text-xs font-medium',
              usage.spentPct >= 90
                ? 'text-red-500'
                : usage.spentPct >= 70
                  ? 'text-amber-500'
                  : 'text-muted-foreground',
            )}
          >
            {usage.spentPct}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full transition-all duration-500', barColor)}
            style={{ width: `${Math.min(100, usage.spentPct)}%` }}
          />
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Còn lại: ${usage.remainingUsd.toFixed(4)} — reset sau {hoursUntilReset}h (00:00 UTC).
      </p>

      {showUpgradeCTA && (
        <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-start gap-2">
            <TrendingUp className="mt-0.5 h-4 w-4 text-primary" />
            <div className="flex-1">
              <p className="text-xs font-medium">Nâng cấp Pro để có 10x quota</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                $5/ngày AI + unlimited docs + priority support
              </p>
            </div>
            <Button size="sm" variant="default" asChild>
              <Link href="/pricing">Upgrade</Link>
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
