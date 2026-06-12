import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, FileText, Flame, MessageSquare, Sparkles, Zap } from 'lucide-react';

import { getServerSession } from '@/lib/auth-server';
import { apiServer } from '@/lib/api-server';
import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { NeuralPattern } from '@/components/ui/neural-pattern';
import { SectionHeading } from '@/components/ui/section-heading';
import { DashboardStatsBand } from '@/components/dashboard/stats-band';
import { ExploreGrid } from '@/components/dashboard/explore-grid';
import { DashboardQuickActions } from '@/components/dashboard/dashboard-quick-actions';
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DashboardStats = {
  totalDocs: number;
  cardsDue: number;
  totalConv: number;
  xp: number;
  streak: number;
  recentDocs: Array<{ id: string; filename: string; createdAt: string; status: string }>;
  firstWorkspaceId: string | null;
  hasFlashcards: boolean;
};

function greetingByHour(hour: number, name: string | null): string {
  const who = name ? `, ${name}` : '';
  if (hour < 5) return `Khuya rồi${who}`;
  if (hour < 12) return `Chào buổi sáng${who}`;
  if (hour < 17) return `Chào buổi chiều${who}`;
  if (hour < 21) return `Chào buổi tối${who}`;
  return `Đêm muộn${who}`;
}

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/dashboard');
  const firstName = session.user.name?.split(' ').pop() ?? null;

  const {
    totalDocs,
    cardsDue,
    totalConv,
    xp,
    streak,
    recentDocs,
    firstWorkspaceId,
    hasFlashcards,
  } = await apiServer<DashboardStats>('/api/dashboard');

  const tutorHref = '/workspaces/new-chat';

  const hasWorkspace = firstWorkspaceId !== null;
  const onboardingDismissed = (await cookies()).get('cogniva_ob_done')?.value === '1';
  const allStepsDone = hasWorkspace && totalDocs > 0 && totalConv > 0 && hasFlashcards;
  const isOnboarding = !onboardingDismissed && !allStepsDone;

  const greeting = greetingByHour(new Date().getHours(), firstName);

  return (
    <PageShell size="wide" padded className="space-y-10">
      <PageHero
        eyebrow="AI Learning OS"
        eyebrowIcon={Sparkles}
        title={greeting}
        description={
          <>
            Hệ điều hành học tập cộng tác. Upload tài liệu, chat với AI có citation, ôn flashcard
            FSRS, kết nối khái niệm trên knowledge graph.
            {(streak > 0 || cardsDue > 0) && (
              <span className="mt-3 flex flex-wrap items-center gap-2">
                {streak > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/20 bg-orange-500/5 px-2.5 py-1 text-xs font-medium text-orange-700 dark:text-orange-400">
                    <Flame className="h-3 w-3" />
                    <span className="tabular-nums">{streak}</span> ngày liên tục
                  </span>
                )}
                {cardsDue > 0 && (
                  <Link
                    href="/flashcards/review"
                    className="border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                  >
                    <Zap className="h-3 w-3" />
                    <span className="tabular-nums">{cardsDue}</span> thẻ cần ôn hôm nay
                  </Link>
                )}
              </span>
            )}
          </>
        }
        decoration={
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-2/3 [mask-image:radial-gradient(ellipse_at_right,_black_20%,_transparent_72%)]"
          >
            <NeuralPattern className="text-primary opacity-[0.16]" />
          </div>
        }
      >
        {recentDocs[0] && (
          <div className="w-full sm:w-[280px]">
            <ContinueFromCard doc={recentDocs[0]} cardsDue={cardsDue} tutorHref={tutorHref} />
          </div>
        )}
      </PageHero>

      {isOnboarding ? (
        <OnboardingChecklist
          hasWorkspace={hasWorkspace}
          hasDocs={totalDocs > 0}
          hasChat={totalConv > 0}
          hasFlashcards={hasFlashcards}
          tutorHref={tutorHref}
          flashcardHref={firstWorkspaceId ? `/workspaces/${firstWorkspaceId}` : tutorHref}
        />
      ) : (
        <>
          <section className="animate-fade-in-up [animation-delay:80ms]">
            <SectionHeading>Tổng quan</SectionHeading>
            <DashboardStatsBand
              totalDocs={totalDocs}
              cardsDue={cardsDue}
              totalConv={totalConv}
              xp={xp}
              streak={streak}
            />
          </section>

          <section className="animate-fade-in-up [animation-delay:160ms]">
            <SectionHeading>Hành động nhanh</SectionHeading>
            <DashboardQuickActions
              cardsDue={cardsDue}
              totalDocs={totalDocs}
              tutorHref={tutorHref}
            />
          </section>

          <section className="animate-fade-in-up [animation-delay:240ms]">
            <SectionHeading>Khám phá Cogniva</SectionHeading>
            <ExploreGrid />
          </section>
        </>
      )}
    </PageShell>
  );
}

function ContinueFromCard({
  doc,
  cardsDue,
  tutorHref,
}: {
  doc: { id: string; filename: string; createdAt: string };
  cardsDue: number;
  tutorHref: string;
}) {
  return (
    <div className="border-divider bg-card/80 shadow-soft rounded-xl border p-3 backdrop-blur-sm">
      <p className="text-text-muted mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
        Tiếp tục từ
      </p>
      <Link
        href={`/documents/${doc.id}`}
        className="group/cf hover:bg-muted/40 -m-1.5 flex items-center gap-2.5 rounded-lg p-1.5 transition-colors"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/15 to-indigo-500/10 text-blue-600 ring-1 ring-inset ring-blue-500/20 dark:text-blue-400">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{doc.filename}</p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">Mở để xem lại</p>
        </div>
        <ArrowRight className="text-muted-foreground/40 group-hover/cf:text-foreground h-3.5 w-3.5 shrink-0 transition-all group-hover/cf:translate-x-0.5" />
      </Link>
      <div className="mt-2 flex gap-1.5">
        <Link
          href={tutorHref}
          className="bg-primary text-primary-foreground shadow-primary hover:bg-primary-hover inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors"
        >
          <MessageSquare className="h-3 w-3" />
          Hỏi AI
        </Link>
        {cardsDue > 0 && (
          <Link
            href="/flashcards/review"
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            <Zap className="h-3 w-3" />
            Ôn {cardsDue}
          </Link>
        )}
      </div>
    </div>
  );
}
