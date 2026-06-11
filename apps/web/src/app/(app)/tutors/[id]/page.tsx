/**
 * /tutors/[id] — tutor profile detail.
 *
 * Server fetch profile + subjects + availability. Hiển thị:
 *   - Hero header với banner + avatar + headline + verify badge
 *   - Stats row: rating / sessions / price
 *   - Bio markdown
 *   - Subjects list với verify chip
 *   - Availability matrix (7 ngày x slot)
 *   - "Liên hệ" button → trigger DM modal/redirect
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Clock,
  MapPin,
  MessageCircle,
  Star,
  Trophy,
  Verified,
  Zap,
} from 'lucide-react';

import { desc } from 'drizzle-orm';

import {
  db,
  LEVEL_NAMES,
  MODALITY_NAMES,
  SUBJECT_BY_SLUG,
  tutorAvailability,
  tutorProfile,
  tutorReview,
  tutorSubject,
  user as userTable,
} from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SectionHeading } from '@/components/ui/section-heading';
import { BookButton } from '@/components/tutoring/book-button';
import { ContactTutorButton } from '@/components/tutoring/contact-tutor-button';
import { NeuralPattern } from '@/components/ui/neural-pattern';
import { SubjectVerifyButton } from '@/components/tutoring/subject-verify-button';
import { FavoriteButton } from '@/components/tutoring/favorite-button';
import { tutorFavorite, tutoringBooking, tutoringPack } from '@cogniva/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

type Params = { params: Promise<{ id: string }> };

export default async function TutorDetailPage({ params }: Params) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/sign-in?redirect=/tutors/${id}`);

  const [profile] = await db
    .select({
      id: tutorProfile.id,
      userId: tutorProfile.userId,
      headline: tutorProfile.headline,
      bio: tutorProfile.bio,
      hourlyRateVnd: tutorProfile.hourlyRateVnd,
      modality: tutorProfile.modality,
      avatarUrl: tutorProfile.avatarUrl,
      bannerUrl: tutorProfile.bannerUrl,
      sessionsCompleted: tutorProfile.sessionsCompleted,
      ratingAvg: tutorProfile.ratingAvg,
      ratingCount: tutorProfile.ratingCount,
      verificationStatus: tutorProfile.verificationStatus,
      status: tutorProfile.status,
      // V4 T2 + T5 trust signals
      instantBookEnabled: tutorProfile.instantBookEnabled,
      trialSessionEnabled: tutorProfile.trialSessionEnabled,
      avgResponseMinutes: tutorProfile.avgResponseMinutes,
      responseRatePct: tutorProfile.responseRatePct,
      introVideoUrl: tutorProfile.introVideoUrl,
      introVideoThumbUrl: tutorProfile.introVideoThumbUrl,
      userName: userTable.name,
      userImage: userTable.image,
    })
    .from(tutorProfile)
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(eq(tutorProfile.id, id))
    .limit(1);

  if (!profile) notFound();

  const isOwner = profile.userId === session.user.id;
  if (profile.status !== 'PUBLISHED' && !isOwner) notFound();

  const [subjects, availability, reviews, packs, isFavorited, hasTrialUsed] =
    await Promise.all([
      db.select().from(tutorSubject).where(eq(tutorSubject.tutorId, id)),
      db
        .select()
        .from(tutorAvailability)
        .where(eq(tutorAvailability.tutorId, id))
        .orderBy(
          asc(tutorAvailability.dayOfWeek),
          asc(tutorAvailability.startTime),
        ),
      db
        .select({
          id: tutorReview.id,
          rating: tutorReview.rating,
          comment: tutorReview.comment,
          createdAt: tutorReview.createdAt,
          reviewerName: userTable.name,
          reviewerImage: userTable.image,
        })
        .from(tutorReview)
        .innerJoin(userTable, eq(userTable.id, tutorReview.reviewerId))
        .where(and(eq(tutorReview.tutorId, id), isNull(tutorReview.hiddenAt)))
        .orderBy(desc(tutorReview.createdAt))
        .limit(20),
      // V4 T3 — fetch active packs
      db
        .select()
        .from(tutoringPack)
        .where(and(eq(tutoringPack.tutorId, id), eq(tutoringPack.status, 'ACTIVE'))),
      // V4 T5 — check user đã favorite tutor này chưa
      session
        ? db
            .select({ tutorId: tutorFavorite.tutorId })
            .from(tutorFavorite)
            .where(
              and(
                eq(tutorFavorite.userId, session.user.id),
                eq(tutorFavorite.tutorId, id),
              ),
            )
            .limit(1)
            .then((rows) => rows.length > 0)
        : Promise.resolve(false),
      // V4 T2 — check user đã từng dùng trial với tutor này chưa
      session
        ? db
            .select({ id: tutoringBooking.id })
            .from(tutoringBooking)
            .where(
              and(
                eq(tutoringBooking.studentId, session.user.id),
                eq(tutoringBooking.tutorId, id),
                eq(tutoringBooking.isTrial, true),
              ),
            )
            .limit(1)
            .then((rows) => rows.length > 0)
        : Promise.resolve(false),
    ]);

  const trialEligible =
    !!profile.trialSessionEnabled && !hasTrialUsed && !isOwner;

  const isVerified = profile.verificationStatus === 'KYC_VERIFIED';
  const priceK = Math.round(profile.hourlyRateVnd / 1000);
  const ratingAvg = profile.ratingAvg ? Number(profile.ratingAvg) : null;

  // Group availability theo day
  const availByDay: Record<number, typeof availability> = {};
  for (const a of availability) {
    (availByDay[a.dayOfWeek] ??= []).push(a);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      {/* Back link */}
      <Link
        href="/tutoring?tab=tutors"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại danh sách
      </Link>

      {/* ══ Hero header (gọn) ══════════════════════════════ */}
      <header className="relative overflow-hidden rounded-2xl bg-card shadow-soft">
        {/* Banner mỏng — chỉ là dải trang trí, không chiếm chỗ */}
        <div className="relative h-20 overflow-hidden bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
          {profile.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.bannerUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 opacity-30">
              <NeuralPattern className="text-primary" />
            </div>
          )}
        </div>
        <div className="relative px-5 pb-5 pt-0 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="relative -mt-10 shrink-0">
              <Avatar className="h-20 w-20 ring-4 ring-card">
                <AvatarImage
                  src={profile.avatarUrl ?? profile.userImage ?? undefined}
                  alt={profile.userName ?? ''}
                />
                <AvatarFallback className="text-2xl font-semibold">
                  {(profile.userName ?? '?')[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {isVerified && (
                <div
                  title="Đã xác thực CCCD"
                  className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-card"
                >
                  <CheckCircle2 className="h-5 w-5 fill-primary text-primary-foreground" strokeWidth={2} />
                </div>
              )}
            </div>
            <div className="min-w-0 space-y-1">
              <h1 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
                {profile.userName ?? 'Anonymous'}
              </h1>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {profile.headline}
              </p>
              {/* Trust badge row */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {isVerified && (
                  <span
                    title="Đã xác thực CCCD + bằng cấp"
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary"
                  >
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Đã xác thực
                  </span>
                )}
                {profile.instantBookEnabled && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-discovery-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-discovery-700 dark:text-discovery-300">
                    <Zap className="h-2.5 w-2.5" />
                    Đặt ngay
                  </span>
                )}
                {profile.avgResponseMinutes != null && profile.avgResponseMinutes < 60 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                    <MessageCircle className="h-2.5 w-2.5" />
                    Trả lời {profile.avgResponseMinutes}p
                  </span>
                )}
                {profile.sessionsCompleted >= 100 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
                    <Trophy className="h-2.5 w-2.5" />
                    100+ buổi
                  </span>
                )}
                {profile.status === 'DRAFT' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-400">
                    Draft
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ══ Layout 2 cột: nội dung + card hành động sticky ══ */}
      <div className="grid items-start gap-5 md:grid-cols-[1fr_300px]">
        {/* Card hành động — gom giá + nút + stats. DOM đứng trước nên trên
            mobile nổi ngay dưới hero; desktop đẩy sang phải qua md:order. */}
        <aside className="order-first space-y-3 md:order-last md:sticky md:top-5">
          <div className="rounded-2xl border border-divider bg-card p-4 shadow-soft">
            <div className="flex items-baseline gap-1">
              {/* Giá metric to → dùng sans Geist (bỏ font-mono), giữ tabular-nums */}
              <span className="text-2xl font-semibold tabular-nums tracking-tight">
                {priceK}K
              </span>
              <span className="text-xs text-text-muted">vnd/giờ</span>
            </div>

            {!isOwner ? (
              <div className="mt-3 flex flex-col gap-2 [&>button]:w-full [&>button]:justify-center">
                <BookButton
                  tutorId={profile.id}
                  tutorName={profile.userName ?? 'Gia sư'}
                  hourlyRateVnd={profile.hourlyRateVnd}
                  subjects={subjects.map((s) => ({
                    id: s.id,
                    subjectSlug: s.subjectSlug,
                    level: s.level,
                  }))}
                  availability={availability.map((a) => ({
                    dayOfWeek: a.dayOfWeek,
                    startTime: a.startTime,
                    endTime: a.endTime,
                  }))}
                  instantBookEnabled={profile.instantBookEnabled ?? false}
                  trialEligible={trialEligible}
                />
                <ContactTutorButton tutorUserId={profile.userId} />
                <FavoriteButton tutorId={profile.id} initialFavorited={isFavorited} />
                {trialEligible && (
                  <p className="text-center text-[11px] text-emerald-600 dark:text-emerald-400">
                    ✨ Có buổi học thử miễn phí
                  </p>
                )}
              </div>
            ) : (
              <Link
                href="/tutoring?tab=mine"
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-divider bg-surface px-3 py-2 text-xs font-medium shadow-soft transition-colors hover:bg-muted"
              >
                Về dashboard
              </Link>
            )}

            {/* Stats gọn trong card */}
            <div className="mt-4 space-y-2 border-t border-divider pt-3">
              <StatRow
                icon={Star}
                label="Đánh giá"
                value={ratingAvg !== null ? ratingAvg.toFixed(1) : '—'}
                hint={ratingAvg !== null ? `${profile.ratingCount} lượt` : 'chưa có'}
              />
              <StatRow
                icon={Calendar}
                label="Buổi đã dạy"
                value={String(profile.sessionsCompleted)}
                hint={null}
              />
              <StatRow
                icon={BookOpen}
                label="Môn dạy"
                value={String(subjects.length)}
                hint={null}
              />
              <StatRow
                icon={MapPin}
                label="Hình thức"
                value={MODALITY_NAMES[profile.modality] ?? '—'}
                hint={null}
              />
            </div>
          </div>
        </aside>

        {/* Cột nội dung chính */}
        <main className="order-last min-w-0 space-y-5 md:order-first">
      {/* ══ Bio ═══════════════════════════════════════════ */}
      <section>
        {/* Tiêu đề mục dùng SectionHeading chung */}
        <SectionHeading>Giới thiệu</SectionHeading>
        <div className="rounded-xl bg-card p-5 shadow-soft">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
            {profile.bio}
          </p>
        </div>
      </section>

      {/* ══ Subjects ══════════════════════════════════════ */}
      <section>
        {/* Tiêu đề mục — số môn truyền qua prop count */}
        <SectionHeading count={subjects.length}>Môn dạy</SectionHeading>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((s) => {
            const def = SUBJECT_BY_SLUG[s.subjectSlug];
            const isVer = s.verifiedAt !== null;
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-soft"
              >
                <span className="text-2xl">{def?.emoji ?? '📚'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold tracking-tight">
                    {def?.name ?? s.subjectSlug}
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {LEVEL_NAMES[s.level as keyof typeof LEVEL_NAMES] ?? s.level}
                  </p>
                </div>
                {isOwner ? (
                  <SubjectVerifyButton
                    tutorId={profile.id}
                    subjectId={s.id}
                    isVerified={isVer}
                    verifyScore={s.verifyScore}
                  />
                ) : (
                  isVer && (
                    <span
                      title={`Verified ${s.verifyScore}%`}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary"
                    >
                      <Verified className="h-3 w-3" />
                      Verified
                    </span>
                  )
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ══ Availability ═════════════════════════════════ */}
      <section>
        {/* Tiêu đề mục dùng SectionHeading chung */}
        <SectionHeading>Khung giờ</SectionHeading>
        <div className="rounded-xl bg-card p-5 shadow-soft">
          <div className="grid grid-cols-7 gap-2">
            {DAY_NAMES.map((day, i) => {
              const slots = availByDay[i] ?? [];
              return (
                <div key={i} className="space-y-1.5">
                  <p className="text-center font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                    {day}
                  </p>
                  {slots.length === 0 ? (
                    <div className="rounded-md border border-dashed border-divider py-2 text-center text-[10px] text-text-muted/60">
                      —
                    </div>
                  ) : (
                    slots.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-md bg-primary/10 px-1 py-1 text-center font-mono text-[10.5px] tabular-nums text-primary"
                      >
                        <Clock className="mx-auto mb-0.5 h-2.5 w-2.5" />
                        {s.startTime}
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ══ Video intro (V4 T5) ═══════════════════════════ */}
      {profile.introVideoUrl && (
        <section>
          {/* Tiêu đề mục dùng SectionHeading chung */}
          <SectionHeading>Video giới thiệu</SectionHeading>
          <div className="overflow-hidden rounded-2xl bg-card shadow-soft">
            <video
              controls
              poster={profile.introVideoThumbUrl ?? undefined}
              className="aspect-video w-full bg-black"
              preload="metadata"
            >
              <source src={profile.introVideoUrl} type="video/mp4" />
            </video>
          </div>
        </section>
      )}

      {/* ══ Packs giảm giá (V4 T3) ════════════════════════ */}
      {packs.length > 0 && !isOwner && (
        <section>
          {/* Tiêu đề mục — số pack truyền qua prop count */}
          <SectionHeading count={packs.length}>Pack giảm giá</SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {packs.map((p) => {
              const subjDef = SUBJECT_BY_SLUG[p.subjectSlug];
              return (
                <div
                  key={p.id}
                  className="flex flex-col gap-2 rounded-2xl border border-discovery-500/20 bg-gradient-to-br from-discovery-500/5 to-transparent p-4 shadow-soft"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[12px] font-semibold">
                      {subjDef?.emoji} {subjDef?.name ?? p.subjectSlug}
                    </span>
                    {p.discountPct > 0 && (
                      <span className="rounded-full bg-discovery-500/15 px-2 py-0.5 text-[10px] font-bold text-discovery-700 dark:text-discovery-300">
                        -{p.discountPct}%
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold tracking-tight">
                    {p.sessionCount} buổi × {p.durationMin} phút
                  </p>
                  {p.description && (
                    <p className="line-clamp-2 text-[11.5px] text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                  <div className="mt-auto flex items-end justify-between border-t border-divider pt-2.5">
                    <div>
                      <p className="font-mono text-lg font-semibold tabular-nums">
                        {(p.totalVnd / 1000).toLocaleString('vi-VN')}k
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        ≈ {(p.ratePerSessionVnd / 1000).toFixed(0)}k/buổi
                      </p>
                    </div>
                    <form action={`/api/tutoring/packs/${p.id}/purchase`} method="POST">
                      <button
                        type="submit"
                        className="rounded-lg bg-discovery-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-discovery-700"
                      >
                        Mua pack
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ══ Reviews ═══════════════════════════════════════ */}
      {reviews.length > 0 && (
        <section>
          {/* Tiêu đề mục — số đánh giá truyền qua prop count */}
          <SectionHeading count={reviews.length}>
            Đánh giá từ học sinh
          </SectionHeading>
          <ul className="space-y-2">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-xl bg-card p-4 shadow-soft">
                <div className="flex items-start gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={r.reviewerImage ?? undefined} />
                    <AvatarFallback className="text-xs">
                      {(r.reviewerName ?? '?')[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{r.reviewerName ?? 'Anonymous'}</p>
                      <span className="inline-flex items-center gap-0.5 text-[11px]">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={
                              i < r.rating
                                ? 'h-3 w-3 fill-amber-500 text-amber-500'
                                : 'h-3 w-3 text-muted-foreground/30'
                            }
                          />
                        ))}
                      </span>
                      <span className="text-[10.5px] text-text-muted">
                        {r.createdAt.toLocaleDateString('vi-VN')}
                      </span>
                    </div>
                    {r.comment && (
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
                        {r.comment}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

        </main>
      </div>
    </div>
  );
}

/** Hàng thống kê gọn trong card hành động: icon + nhãn trái, giá trị phải. */
function StatRow({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Star;
  label: string;
  value: string;
  hint: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="text-right">
        <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
        {hint && <span className="ml-1 text-[10.5px] text-text-muted">{hint}</span>}
      </span>
    </div>
  );
}
