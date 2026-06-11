'use client';

import * as React from 'react';
import Link from 'next/link';
import { Flame } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';

type Stats = {
  xp: number;
  currentStreak: number;
};

export function StreakBadge() {
  const { data: stats } = useQuery({
    queryKey: qk.profileMe(),
    queryFn: () => apiGet<{ stats: Stats }>('/api/profile/me').then((d) => d.stats),
  });

  if (!stats) return null;

  return (
    <Link
      href="/profile"
      className="hover:bg-muted hidden items-center gap-1 rounded-md border px-2 py-1 text-xs sm:flex"
      title={`${stats.xp} XP · ${stats.currentStreak} ngày streak`}
    >
      <Flame
        className={`h-3.5 w-3.5 ${
          stats.currentStreak > 0 ? 'text-orange-500' : 'text-muted-foreground'
        }`}
      />
      <span className="font-medium tabular-nums">{stats.currentStreak}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground tabular-nums">{stats.xp} XP</span>
    </Link>
  );
}
