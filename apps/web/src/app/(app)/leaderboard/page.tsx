import Link from 'next/link';
import { Flame, Trophy } from 'lucide-react';

import { apiServer } from '@/lib/api-server';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LeaderboardRow = {
  rank: number;
  userId: string;
  name: string | null;
  image: string | null;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  achievementsCount: number;
};

const PODIUM_STYLES: Array<{
  bg: string;
  ring: string;
  text: string;
  label: string;
}> = [
  {
    bg: 'from-amber-500/15 via-amber-500/8 to-transparent',
    ring: 'ring-amber-500/40',
    text: 'text-amber-700 dark:text-amber-400',
    label: 'Vàng',
  },
  {
    bg: 'from-slate-400/15 via-slate-400/8 to-transparent',
    ring: 'ring-slate-400/40',
    text: 'text-slate-700 dark:text-slate-300',
    label: 'Bạc',
  },
  {
    bg: 'from-orange-700/15 via-orange-700/8 to-transparent',
    ring: 'ring-orange-700/40',
    text: 'text-orange-800 dark:text-orange-400',
    label: 'Đồng',
  },
];

export default async function LeaderboardPage() {
  const { leaderboard: rows } = await apiServer<{ leaderboard: LeaderboardRow[] }>(
    '/api/leaderboard?limit=20',
  );

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <PageShell
      size="wide"
      padded
      className="space-y-10"
      eyebrowIcon={Trophy}
      title="Top học viên"
      description="Xếp hạng theo XP — chỉ user bật public profile trong Settings mới xuất hiện."
    >
      {rows.length === 0 && (
        <EmptyState
          icon={Trophy}
          title="Chưa có user nào công khai"
          description="Vào Settings để bật public profile — bạn sẽ xuất hiện trên bảng xếp hạng."
        />
      )}

      {top3.length > 0 && (
        <section>
          <SectionHeading count={top3.length}>Top 3</SectionHeading>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {top3.map((r) => {
              const style = PODIUM_STYLES[r.rank - 1]!;
              return (
                <Link
                  key={r.userId}
                  href={`/profile/${r.userId}`}
                  className={cn(
                    'group/p border-divider bg-card shadow-soft duration-base ease-expo-out hover:shadow-elevated relative overflow-hidden rounded-2xl border p-5 transition-all hover:-translate-y-0.5',
                    'bg-gradient-to-br',
                    style.bg,
                  )}
                >
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="flex items-center gap-2">
                      <Trophy className={cn('h-4 w-4', style.text)} strokeWidth={2.25} />
                      <span
                        className={cn(
                          'font-mono text-[11px] font-semibold uppercase tracking-[0.14em]',
                          style.text,
                        )}
                      >
                        #{r.rank} · {style.label}
                      </span>
                    </div>
                    <Avatar
                      className={cn('ring-offset-card h-16 w-16 ring-2 ring-offset-2', style.ring)}
                    >
                      <AvatarImage src={r.image ?? undefined} alt={r.name ?? ''} />
                      <AvatarFallback className="text-lg font-semibold">
                        {(r.name ?? 'U')[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <p className="line-clamp-1 text-sm font-semibold tracking-tight">
                      {r.name ?? 'Anonymous'}
                    </p>
                    <p className="text-2xl font-semibold tabular-nums leading-none tracking-tight">
                      {r.xp.toLocaleString('vi-VN')}
                      <span className="text-muted-foreground ml-1 text-xs font-normal">XP</span>
                    </p>
                    {r.currentStreak > 0 && (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                        <Flame className="h-3 w-3 text-orange-500" />
                        <span className="font-mono font-semibold tabular-nums">
                          {r.currentStreak}
                        </span>{' '}
                        ngày streak
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <SectionHeading count={rest.length}>Hạng 4 trở đi</SectionHeading>
          <ul className="border-divider bg-card shadow-soft overflow-hidden rounded-xl border">
            {rest.map((r, i) => (
              <li key={r.userId} className={cn(i > 0 && 'border-divider border-t')}>
                <Link
                  href={`/profile/${r.userId}`}
                  className="group/row hover:bg-muted/40 flex items-center gap-3 px-4 py-3 transition-colors"
                >
                  <span className="text-muted-foreground w-8 text-center font-mono text-sm font-semibold tabular-nums">
                    #{r.rank}
                  </span>
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={r.image ?? undefined} alt={r.name ?? ''} />
                    <AvatarFallback>{(r.name ?? 'U')[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight">
                    {r.name ?? 'Anonymous'}
                  </p>
                  {r.currentStreak > 0 && (
                    <span className="text-muted-foreground hidden items-center gap-1 text-xs sm:inline-flex">
                      <Flame className="h-3 w-3 text-orange-500" />
                      <span className="font-mono tabular-nums">{r.currentStreak}</span>
                    </span>
                  )}
                  <span className="w-24 text-right">
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {r.xp.toLocaleString('vi-VN')}
                    </span>
                    <span className="text-muted-foreground ml-1 text-[11px]">XP</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
