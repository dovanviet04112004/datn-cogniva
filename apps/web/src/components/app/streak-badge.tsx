/**
 * StreakBadge — flame icon + số ngày streak hiện tại, hiển thị trong topbar.
 *
 * Fetch /api/profile/me 1 lần khi mount + cache. Khi user làm activity
 * (review/quiz/note/upload), badge có thể stale tới khi refresh page.
 *
 * Click → navigate sang /profile.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Flame } from 'lucide-react';

type Stats = {
  xp: number;
  currentStreak: number;
};

export function StreakBadge() {
  const [stats, setStats] = React.useState<Stats | null>(null);

  React.useEffect(() => {
    fetch('/api/profile/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stats: Stats } | null) => {
        if (d?.stats) setStats(d.stats);
      })
      .catch(() => {
        /* silent */
      });
  }, []);

  if (!stats) return null;

  return (
    <Link
      href="/profile"
      className="hidden items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted sm:flex"
      title={`${stats.xp} XP · ${stats.currentStreak} ngày streak`}
    >
      <Flame
        className={`h-3.5 w-3.5 ${
          stats.currentStreak > 0 ? 'text-orange-500' : 'text-muted-foreground'
        }`}
      />
      <span className="tabular-nums font-medium">{stats.currentStreak}</span>
      <span className="text-muted-foreground">·</span>
      <span className="tabular-nums text-muted-foreground">{stats.xp} XP</span>
    </Link>
  );
}
