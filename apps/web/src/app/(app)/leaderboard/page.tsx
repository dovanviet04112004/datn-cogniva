/**
 * /leaderboard — top users by XP. Chỉ user `isPublic = true` xuất hiện.
 *
 * Layout: list dọc, top 3 highlight gold/silver/bronze background.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Flame, Trophy } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';

type Row = {
  rank: number;
  userId: string;
  name: string | null;
  image: string | null;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  achievementsCount: number;
};

const RANK_STYLES = [
  'bg-amber-500/15 ring-2 ring-amber-500/40', // 1
  'bg-slate-400/15 ring-2 ring-slate-400/40', // 2
  'bg-amber-700/15 ring-2 ring-amber-700/40', // 3
];

export default function LeaderboardPage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch('/api/leaderboard?limit=20')
      .then((r) => r.json())
      .then((d: { leaderboard: Row[] }) => setRows(d.leaderboard))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Trophy className="h-6 w-6 text-amber-500" />
          Leaderboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Top học viên theo XP. Chỉ user công khai profile (Settings) mới có
          mặt ở đây.
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Đang tải...</p>}
      {!loading && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Chưa có user nào công khai. Vào{' '}
          <Link href="/profile" className="underline">
            /profile
          </Link>{' '}
          để bật.
        </Card>
      )}

      <ul className="space-y-2">
        {rows.map((r) => (
          <Card
            key={r.userId}
            className={`flex items-center gap-3 p-3 ${
              r.rank <= 3 ? RANK_STYLES[r.rank - 1] : ''
            }`}
          >
            <span className="w-8 text-center text-lg font-bold tabular-nums">
              #{r.rank}
            </span>
            <Avatar className="h-10 w-10">
              <AvatarImage src={r.image ?? undefined} alt={r.name ?? ''} />
              <AvatarFallback>
                {(r.name ?? 'U')[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <Link
              href={`/profile/${r.userId}`}
              className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
            >
              {r.name ?? 'Anonymous'}
            </Link>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Flame className="h-3 w-3 text-orange-500" />
              {r.currentStreak}
            </span>
            <span className="w-20 text-right text-sm font-bold tabular-nums">
              {r.xp.toLocaleString('vi-VN')} XP
            </span>
          </Card>
        ))}
      </ul>
    </div>
  );
}
