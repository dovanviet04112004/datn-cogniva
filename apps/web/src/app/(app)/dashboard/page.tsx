/**
 * Dashboard — trang chủ landing sau khi đăng nhập.
 *
 * Cogniva premium dashboard:
 *   1. Hero — greeting adaptive theo giờ + AI Learning OS tagline + streak/
 *      cards-due callout + Continue-from card (hero phải) khi có tài liệu gần đây.
 *   2. Stats — 4 metric thực từ DB (docs / cards due / conversations / XP)
 *      với accent dot + font-mono tabular-nums + status hint.
 *   3. Quick actions (DashboardQuickActions, client) — 4 card HÀNH ĐỘNG THẬT:
 *      Upload MỞ MODAL NGAY TẠI CHỖ (không rời trang), Hỏi AI → /workspaces/new-chat
 *      (tự tạo workspace nếu chưa có rồi vào thẳng chat), Ôn flashcard, Bản đồ kiến
 *      thức. Card Upload thành CTA "urgent" khi user chưa có tài liệu nào.
 *
 * Server Component — fetch parallel 1 RTT qua Drizzle, không cần client fetch
 * → instant render, không loading flash.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  FileText,
  Flame,
  MessageSquare,
  Sparkles,
  Zap,
} from 'lucide-react';

import { getServerSession } from '@/lib/auth-server';
import { getDashboardStats } from '@/lib/dashboard/get-dashboard-stats';
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

/** Greeting adaptive theo giờ local server (Asia/HCM proxy). */
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
  const userId = session.user.id;
  const firstName = session.user.name?.split(' ').pop() ?? null;

  // Số liệu tổng quan — đã tách ra lib-fn cache-aside (TTL 60s) dùng chung.
  const {
    totalDocs,
    cardsDue,
    totalConv,
    xp,
    streak,
    recentDocs,
    firstWorkspaceId,
    hasFlashcards,
  } = await getDashboardStats(userId);

  // "Hỏi AI Tutor" LUÔN mở được chat: route /workspaces/new-chat tự dùng workspace
  // gần nhất hoặc TẠO "Default" nếu user chưa có → không bao giờ vào ngõ cụt.
  const tutorHref = '/workspaces/new-chat';

  // STATE-AWARE: màn ONBOARDING (4 bước) chỉ TỐT NGHIỆP khi xong CẢ 4 bước
  // (workspace → upload → chat → flashcard) HOẶC user bấm "Bỏ qua". KHÔNG tắt giữa
  // chừng (vd vừa upload) → tránh cảm giác "đổi trang" + không bỏ rơi bước flashcard.
  // Cookie `cogniva_ob_done` (server-readable) để bấm Bỏ qua tắt ngay sau refresh,
  // không flicker. Không bao giờ kẹt: luôn có lối Bỏ qua.
  const hasWorkspace = firstWorkspaceId !== null;
  const onboardingDismissed =
    (await cookies()).get('cogniva_ob_done')?.value === '1';
  const allStepsDone = hasWorkspace && totalDocs > 0 && totalConv > 0 && hasFlashcards;
  const isOnboarding = !onboardingDismissed && !allStepsDone;

  const greeting = greetingByHour(new Date().getHours(), firstName);

  return (
    <PageShell size="wide" padded className="space-y-10">
      {/* ══ Hero — dùng PageHero CHUNG (giống mọi trang khác) ════
          Greeting → title; tagline + badge streak/thẻ → description; NeuralPattern
          (identity AI OS) → decoration; ContinueFromCard → slot phải (children). */}
      <PageHero
        eyebrow="AI Learning OS"
        eyebrowIcon={Sparkles}
        title={greeting}
        description={
          <>
            Hệ điều hành học tập cộng tác. Upload tài liệu, chat với AI có citation,
            ôn flashcard FSRS, kết nối khái niệm trên knowledge graph.
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
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
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
            <ContinueFromCard
              doc={recentDocs[0]}
              cardsDue={cardsDue}
              tutorHref={tutorHref}
            />
          </div>
        )}
      </PageHero>

      {isOnboarding ? (
        /* ══ USER MỚI → onboarding dẫn từng bước (tạo workspace trước) ══ */
        <OnboardingChecklist
          hasWorkspace={hasWorkspace}
          hasDocs={totalDocs > 0}
          hasChat={totalConv > 0}
          hasFlashcards={hasFlashcards}
          tutorHref={tutorHref}
          flashcardHref={
            firstWorkspaceId ? `/workspaces/${firstWorkspaceId}` : tutorHref
          }
        />
      ) : (
        <>
          {/* ══ Stats band — dải KPI liền (thay 4 ô vuông) ════════ */}
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

          {/* ══ Quick actions — hành động HỌC TẬP cốt lõi (DO) ══ */}
          <section className="animate-fade-in-up [animation-delay:160ms]">
            <SectionHeading>Hành động nhanh</SectionHeading>
            {/* Client island: Upload mở modal inline, Hỏi AI → new-chat (đảm bảo workspace) */}
            <DashboardQuickActions
              cardsDue={cardsDue}
              totalDocs={totalDocs}
              tutorHref={tutorHref}
            />
          </section>

          {/* ══ Khám phá — ĐỦ chiều rộng hệ thống (giống dải onboarding) ══
              Cogniva không chỉ học tập: kho tài liệu, nhóm học, gia sư, đề thi,
              phòng học… Dùng chung ExploreGrid để nhất quán với onboarding. */}
          <section className="animate-fade-in-up [animation-delay:240ms]">
            <SectionHeading>Khám phá Cogniva</SectionHeading>
            <ExploreGrid />
          </section>
        </>
      )}

    </PageShell>
  );
}

/**
 * ContinueFromCard — card "Tiếp tục từ [tên tài liệu]" trong hero phải.
 *
 * Render thumbnail icon FileText + filename truncate + 2 nút primary (mở doc)
 * và secondary (hỏi AI). Mục đích: lấp khoảng trống bên phải hero, đồng thời
 * cho user 1 click jump-back vào việc đang dở thay vì phải tìm trong list.
 */
function ContinueFromCard({
  doc,
  cardsDue,
  tutorHref,
}: {
  doc: { id: string; filename: string; createdAt: Date };
  cardsDue: number;
  /** Đích "Hỏi AI" — workspace chat gần nhất (truyền từ page). */
  tutorHref: string;
}) {
  return (
    <div className="rounded-xl border border-divider bg-card/80 p-3 shadow-soft backdrop-blur-sm">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
        Tiếp tục từ
      </p>
      <Link
        href={`/documents/${doc.id}`}
        className="group/cf flex items-center gap-2.5 rounded-lg p-1.5 -m-1.5 transition-colors hover:bg-muted/40"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/15 to-indigo-500/10 text-blue-600 ring-1 ring-inset ring-blue-500/20 dark:text-blue-400">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">
            {doc.filename}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Mở để xem lại
          </p>
        </div>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-all group-hover/cf:translate-x-0.5 group-hover/cf:text-foreground" />
      </Link>
      <div className="mt-2 flex gap-1.5">
        <Link
          href={tutorHref}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-[11px] font-semibold text-primary-foreground shadow-primary transition-colors hover:bg-primary-hover"
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
