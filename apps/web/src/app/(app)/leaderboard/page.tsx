/**
 * /leaderboard — top users by XP. Chỉ user `isPublic = true` xuất hiện.
 *
 * Cogniva premium:
 *   - Hero band với Trophy tagline
 *   - Top 3 podium card highlight (gold/silver/bronze) với gradient
 *   - Rest of list: row compact với rank, avatar, streak, XP
 */
/**
 * /leaderboard — top users by XP. Server Component: fetch thẳng DB (Drizzle)
 * → HTML có data ngay first paint, không loading skeleton client-side.
 * Query dùng chung lib `getLeaderboard` với route /api/leaderboard (mobile).
 */
import Link from 'next/link';
import { Flame, Trophy } from 'lucide-react';

import { getLeaderboard } from '@/lib/leaderboard/get-leaderboard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PageShell } from '@/components/layout/page-shell';
// Hero band CHUNG — thay header tự-chế để đồng bộ ngôn ngữ hero toàn app.
import { PageHero } from '@/components/layout/page-hero';
import { EmptyState } from '@/components/layout/empty-state';
import { NeuralPattern } from '@/components/ui/neural-pattern';
// Tiêu đề mục dùng chung toàn app (thay khối eyebrow gạch hardcode cũ).
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const rows = await getLeaderboard(20);

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <PageShell size="wide" padded className="space-y-10">
      {/* ══ Hero band CHUNG — giữ motif amber/gold đặc trưng leaderboard qua decoration ══ */}
      <PageHero
        eyebrow="Bảng xếp hạng"
        eyebrowIcon={Trophy}
        title="Top học viên"
        description="Xếp hạng theo XP. Chỉ user công khai profile mới xuất hiện — mở Settings → Public profile để tham gia."
        decoration={
          <>
            {/* NeuralPattern amber — sắc gold riêng cho leaderboard (giữ qua decoration) */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-2/3 [mask-image:radial-gradient(ellipse_at_right,_black_25%,_transparent_75%)]"
            >
              <NeuralPattern className="text-amber-500 opacity-[0.18]" />
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-amber-500/15 blur-3xl"
            />
          </>
        }
      />

      {rows.length === 0 && (
        <EmptyState
          icon={Trophy}
          title="Chưa có user nào công khai"
          description="Vào Settings để bật public profile — bạn sẽ xuất hiện trên bảng xếp hạng."
        />
      )}

      {/* ══ Top 3 podium ═══════════════════════════════════ */}
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
                    'group/p relative overflow-hidden rounded-2xl border border-divider bg-card p-5 shadow-soft transition-all duration-base ease-expo-out hover:-translate-y-0.5 hover:shadow-elevated',
                    'bg-gradient-to-br',
                    style.bg,
                  )}
                >
                  <div className="flex flex-col items-center gap-3 text-center">
                    {/* Rank badge */}
                    <div className="flex items-center gap-2">
                      <Trophy
                        className={cn('h-4 w-4', style.text)}
                        strokeWidth={2.25}
                      />
                      <span
                        className={cn(
                          // Cỡ chữ chuẩn hoá text-[11px] cho chip/label (design system §3.1)
                          'font-mono text-[11px] font-semibold uppercase tracking-[0.14em]',
                          style.text,
                        )}
                      >
                        #{r.rank} · {style.label}
                      </span>
                    </div>
                    {/* Avatar */}
                    <Avatar
                      className={cn(
                        'h-16 w-16 ring-2 ring-offset-2 ring-offset-card',
                        style.ring,
                      )}
                    >
                      <AvatarImage src={r.image ?? undefined} alt={r.name ?? ''} />
                      <AvatarFallback className="text-lg font-semibold">
                        {(r.name ?? 'U')[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {/* Name */}
                    <p className="line-clamp-1 text-sm font-semibold tracking-tight">
                      {r.name ?? 'Anonymous'}
                    </p>
                    {/* XP — big: dùng sans Geist (bỏ font-mono), giữ tabular-nums. */}
                    <p className="text-2xl font-semibold tabular-nums leading-none tracking-tight">
                      {r.xp.toLocaleString('vi-VN')}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        XP
                      </span>
                    </p>
                    {/* Streak */}
                    {r.currentStreak > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Flame className="h-3 w-3 text-orange-500" />
                        <span className="font-mono tabular-nums font-semibold">
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

      {/* ══ Rest of leaderboard ═══════════════════════════ */}
      {rest.length > 0 && (
        <section>
          <SectionHeading count={rest.length}>Hạng 4 trở đi</SectionHeading>
          <ul className="overflow-hidden rounded-xl border border-divider bg-card shadow-soft">
            {rest.map((r, i) => (
              <li key={r.userId} className={cn(i > 0 && 'border-t border-divider')}>
                <Link
                  href={`/profile/${r.userId}`}
                  className="group/row flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="w-8 text-center font-mono text-sm font-semibold tabular-nums text-muted-foreground">
                    #{r.rank}
                  </span>
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={r.image ?? undefined} alt={r.name ?? ''} />
                    <AvatarFallback>
                      {(r.name ?? 'U')[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight">
                    {r.name ?? 'Anonymous'}
                  </p>
                  {r.currentStreak > 0 && (
                    <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                      <Flame className="h-3 w-3 text-orange-500" />
                      <span className="font-mono tabular-nums">{r.currentStreak}</span>
                    </span>
                  )}
                  <span className="w-24 text-right">
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {r.xp.toLocaleString('vi-VN')}
                    </span>
                    {/* Đơn vị XP — metadata label, chuẩn hoá text-[11px] (design system §3.1) */}
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      XP
                    </span>
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
