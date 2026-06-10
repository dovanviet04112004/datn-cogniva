/**
 * /library/karma — Phase 4 karma leaderboard page (2026-05-27).
 *
 * 2 sections:
 *   1. Top 20 contributors theo karma points (medal cho top 3)
 *   2. Recent karma events activity feed (15 latest)
 */
import Link from 'next/link';
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  Crown,
  Download as DownloadIcon,
  Layers,
  Medal,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
// SectionHeading dùng chung toàn app — thay khối tiêu đề mục gradient cũ.
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';
import { getServerT } from '@/lib/i18n/server';
import { getKarmaBoard } from '@/lib/library/get-karma-board';

// Route bị (app)/layout ép dynamic; data công khai cache ở tầng DATA qua
// unstable_cache trong getKarmaBoard (revalidate 5 phút).
export const dynamic = 'force-dynamic';

const EVENT_META: Record<
  string,
  { labelKey: string; emoji: string; color: string; icon: typeof Sparkles }
> = {
  doc_imported: {
    labelKey: 'library.karma.event.doc_imported',
    emoji: '📥',
    color: 'text-sky-600 dark:text-sky-300',
    icon: DownloadIcon,
  },
  doc_remixed: {
    labelKey: 'library.karma.event.doc_remixed',
    emoji: '🔀',
    color: 'text-discovery-600 dark:text-discovery-300',
    icon: Layers,
  },
  endorsed: {
    labelKey: 'library.karma.event.endorsed',
    emoji: '✓',
    color: 'text-emerald-600 dark:text-emerald-300',
    icon: CheckCircle2,
  },
  high_quality: {
    labelKey: 'library.karma.event.high_quality',
    emoji: '🏆',
    color: 'text-amber-600 dark:text-amber-300',
    icon: Award,
  },
};

export default async function KarmaLeaderboardPage() {
  const t = await getServerT();
  const { leaderboard, recentEvents, totalsByType } = await getKarmaBoard();

  return (
    <PageShell size="wide">
      <Link
        href="/library"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {t('library.back')}
      </Link>

      {/* Hero CHUNG — chip Crown cũ → eyebrowIcon, title/subtitle giữ nguyên. */}
      <PageHero
        eyebrow="Karma"
        eyebrowIcon={Crown}
        title={t('library.karma.title')}
        description={t('library.karma.subtitle')}
        className="mb-6"
      />

      {/* Stats summary */}
      {totalsByType.length > 0 && (
        <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {totalsByType.map((row) => {
            const meta = EVENT_META[row.eventType] ?? EVENT_META.doc_imported!;
            const Icon = meta.icon;
            return (
              <div
                key={row.eventType}
                className="rounded-xl border border-divider bg-card p-3"
              >
                <div className={cn('mb-1 flex items-center gap-1.5', meta.color)}>
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    {t(meta.labelKey)}
                  </span>
                </div>
                <p className="text-xl font-bold tabular-nums">
                  {row.total.toLocaleString('vi-VN')}
                </p>
                <p className="text-[10.5px] text-muted-foreground">
                  +{row.totalPoints} {t('library.karma.pts_total')}
                </p>
              </div>
            );
          })}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Leaderboard */}
        <section>
          {/* Tiêu đề mục bảng xếp hạng + count — SectionHeading chung. */}
          <SectionHeading count={leaderboard.length}>
            <span className="inline-flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
              {t('library.karma.top_contributors')}
            </span>
          </SectionHeading>
          {leaderboard.length === 0 ? (
            <div className="rounded-xl border border-divider bg-card p-8 text-center">
              <p className="text-[12.5px] text-muted-foreground">
                {t('library.karma.empty_leaderboard')}
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {leaderboard.map((l, idx) => {
                const rank = idx + 1;
                const isTop3 = rank <= 3;
                return (
                  <li
                    key={l.userId}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors',
                      isTop3
                        ? 'border-amber-500/40 bg-gradient-to-r from-amber-500/5 to-transparent'
                        : 'border-divider',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-bold',
                        rank === 1
                          ? 'bg-amber-500 text-white'
                          : rank === 2
                            ? 'bg-slate-400 text-white'
                            : rank === 3
                              ? 'bg-amber-700 text-white'
                              : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {isTop3 ? <Medal className="h-3.5 w-3.5" /> : rank}
                    </div>
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={l.image ?? undefined} />
                      <AvatarFallback>
                        {(l.name ?? '?')[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold">
                        {l.name ?? t('library.karma.anonymous')}
                      </p>
                      {l.lastEventAt && (
                        <p className="text-[10.5px] text-muted-foreground">
                          {t('library.karma.last_earn')}{' '}
                          {new Date(l.lastEventAt).toLocaleDateString('vi-VN')}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold tabular-nums">
                        {l.points.toLocaleString('vi-VN')}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{t('library.karma.pts')}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Recent activity */}
        <aside>
          {/* Tiêu đề mục hoạt động gần đây — SectionHeading chung. */}
          <SectionHeading>
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t('library.karma.recent_activity')}
            </span>
          </SectionHeading>
          {recentEvents.length === 0 ? (
            <p className="rounded-xl border border-divider bg-card p-4 text-center text-[12px] text-muted-foreground">
              {t('library.karma.no_events')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recentEvents.map((e) => {
                const meta = EVENT_META[e.eventType] ?? EVENT_META.doc_imported!;
                return (
                  <li
                    key={e.id}
                    className="rounded-lg border border-divider bg-card p-2.5"
                  >
                    <div className="flex items-start gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={e.userImage ?? undefined} />
                        <AvatarFallback className="text-[9px]">
                          {(e.userName ?? '?')[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11.5px]">
                          <span className="font-semibold">{e.userName}</span>
                          <span className="text-muted-foreground">
                            {' '}
                            • {meta.emoji} {t(meta.labelKey)}
                          </span>
                        </p>
                        {e.docId && e.docTitle && (
                          <Link
                            href={`/library/${e.docId}`}
                            className="line-clamp-1 text-[10.5px] text-muted-foreground hover:text-foreground"
                          >
                            → {e.docTitle}
                          </Link>
                        )}
                        <p className="text-[9.5px] text-muted-foreground/70">
                          {new Date(e.createdAt).toLocaleString('vi-VN')}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                          meta.color,
                          'bg-current/10',
                        )}
                      >
                        +{e.points}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>

      {/* Karma earning guide */}
      <section className="mt-8 rounded-2xl border border-divider bg-muted/30 p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('library.karma.how_to_earn')}
        </p>
        <ul className="grid gap-2 text-[12px] sm:grid-cols-2">
          <li className="flex items-center gap-2">
            <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-700 dark:text-sky-300">
              +1
            </span>
            {t('library.karma.earn_import')}
          </li>
          <li className="flex items-center gap-2">
            <span className="rounded-full bg-discovery-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-discovery-700 dark:text-discovery-300">
              +5
            </span>
            {t('library.karma.earn_remix')}
          </li>
          <li className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
              +10
            </span>
            {t('library.karma.earn_endorse')}
          </li>
          <li className="flex items-center gap-2">
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              +20
            </span>
            {t('library.karma.earn_quality')}
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
