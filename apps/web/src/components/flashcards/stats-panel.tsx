/**
 * StatsPanel — số liệu nhanh: due hôm nay, retention 7d, breakdown state.
 *
 * Fetch /api/flashcards/stats khi mount. Render 4 chỉ số với màu dynamic
 * theo ngưỡng (retention < 70% đỏ, 70-85% vàng, > 85% xanh).
 */
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Activity, BookOpen, Clock, TrendingUp } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';

type Stats = {
  byState: { NEW: number; LEARNING: number; REVIEW: number; RELEARNING: number };
  dueToday: number;
  reviewsLast7d: number;
  retentionRate: number;
};

export function StatsPanel() {
  // React Query: cache + dedupe + revalidate, persist IndexedDB → mở lại thấy ngay.
  const { data: stats } = useQuery({
    queryKey: qk.flashcardStats(),
    queryFn: () => apiGet<Stats>('/api/flashcards/stats'),
  });

  if (!stats) {
    return <div className="h-24 animate-pulse rounded-md bg-muted/50" />;
  }

  const total =
    stats.byState.NEW + stats.byState.LEARNING + stats.byState.REVIEW + stats.byState.RELEARNING;

  // Màu retention theo ngưỡng → dùng semantic token: tốt = success, trung bình =
  // warning, kém = destructive (thay hardcode green/yellow/red rời rạc).
  const retentionColor =
    stats.retentionRate >= 0.85
      ? 'text-success'
      : stats.retentionRate >= 0.7
        ? 'text-warning'
        : 'text-destructive';

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={<Clock className="h-5 w-5 text-blue-400" />}
        label="Đến hạn hôm nay"
        value={stats.dueToday}
        accent={
          stats.dueToday > 0 ? (
            <Link href="/flashcards/review" className="text-xs text-primary hover:underline">
              Ôn ngay →
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">Đã sạch queue 🎉</span>
          )
        }
      />
      <StatCard
        icon={<TrendingUp className={cn('h-5 w-5', retentionColor)} />}
        label="Retention 7 ngày"
        value={`${Math.round(stats.retentionRate * 100)}%`}
        accent={<span className="text-xs text-muted-foreground">{stats.reviewsLast7d} reviews</span>}
      />
      <StatCard
        icon={<BookOpen className="h-5 w-5 text-purple-400" />}
        label="Tổng thẻ"
        value={total}
        accent={
          <span className="text-xs text-muted-foreground">
            {stats.byState.NEW} new · {stats.byState.REVIEW} review
          </span>
        }
      />
      <StatCard
        icon={<Activity className="h-5 w-5 text-orange-400" />}
        label="Đang học"
        value={stats.byState.LEARNING + stats.byState.RELEARNING}
        accent={
          <span className="text-xs text-muted-foreground">
            {stats.byState.LEARNING} learning · {stats.byState.RELEARNING} relearn
          </span>
        }
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1">{accent}</div>
    </Card>
  );
}
