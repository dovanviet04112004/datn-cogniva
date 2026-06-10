/**
 * AI Usage Card — hiển thị quota AI hôm nay cho user.
 *
 * Plan v2 §15.1 W6 — visibility cho cost guardrail.
 *
 * UI:
 *   - Progress bar: spent / quota theo plan
 *   - Color: success < 70%, warning 70-90%, destructive > 90%
 *   - Reset time (00:00 UTC kế)
 *   - Upgrade CTA nếu FREE và spent > 50%
 *
 * Data nguồn: GET /api/account/usage (Stage 1 W2).
 */
'use client';

import * as React from 'react';
import { Loader2, Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
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
  // Poll 30s qua refetchInterval — quota update sau mỗi AI call.
  const { data: usage, error } = useQuery({
    queryKey: qk.accountUsage(),
    queryFn: () => apiGet<Usage>('/api/account/usage'),
    refetchInterval: 30_000,
  });

  if (error) {
    return (
      <Card className="p-4">
        <p className="text-sm text-destructive">
          Không tải được quota: {(error as Error).message}
        </p>
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

  // Color theo mức tiêu thụ — map sang token trạng thái:
  //   >90% quá tải → destructive, 70-90% cảnh báo → warning, còn lại ổn → success
  const barColor =
    usage.spentPct >= 90
      ? 'bg-destructive'
      : usage.spentPct >= 70
        ? 'bg-warning'
        : 'bg-success';

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
                ? 'text-destructive'
                : usage.spentPct >= 70
                  ? 'text-warning'
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
