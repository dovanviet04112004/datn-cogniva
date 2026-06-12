import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
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

import { LEVEL_NAMES, MODALITY_NAMES, SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SectionHeading } from '@/components/ui/section-heading';
import { BookButton } from '@/components/tutoring/book-button';
import { ContactTutorButton } from '@/components/tutoring/contact-tutor-button';
import { NeuralPattern } from '@/components/ui/neural-pattern';
import { SubjectVerifyButton } from '@/components/tutoring/subject-verify-button';
import { FavoriteButton } from '@/components/tutoring/favorite-button';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

type Params = { params: Promise<{ id: string }> };

type TutorDetail = {
  profile: {
    id: string;
    userId: string;
    headline: string;
    bio: string;
    hourlyRateVnd: number;
    modality: string;
    avatarUrl: string | null;
    bannerUrl: string | null;
    sessionsCompleted: number;
    ratingAvg: string | null;
    ratingCount: number;
    verificationStatus: string;
    status: string;
    instantBookEnabled: boolean | null;
    trialSessionEnabled: boolean | null;
    avgResponseMinutes: number | null;
    responseRatePct: number | null;
    introVideoUrl: string | null;
    introVideoThumbUrl: string | null;
    userName: string | null;
    userImage: string | null;
  };
  subjects: Array<{
    id: string;
    subjectSlug: string;
    level: string;
    verifiedAt: string | null;
    verifyScore: number | null;
  }>;
  availability: Array<{
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    timezone: string;
  }>;
  reviews: Array<{
    id: string;
    rating: number;
    comment: string | null;
    createdAt: string;
    reviewerName: string | null;
    reviewerImage: string | null;
  }>;
  packs: Array<{
    id: string;
    subjectSlug: string;
    level: string;
    sessionCount: number;
    durationMin: number;
    ratePerSessionVnd: number;
    totalVnd: number;
    discountPct: number;
    description: string | null;
  }>;
  isFavorited: boolean;
  hasTrialUsed: boolean;
  isOwner: boolean;
};

export default async function TutorDetailPage({ params }: Params) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/sign-in?redirect=/tutors/${id}`);

  const detail = await apiServerOrNull<TutorDetail>(`/api/tutors/${id}`);
  if (!detail) notFound();

  const { profile, subjects, availability, reviews, packs, isFavorited, hasTrialUsed, isOwner } =
    detail;

  const trialEligible = !!profile.trialSessionEnabled && !hasTrialUsed && !isOwner;

  const isVerified = profile.verificationStatus === 'KYC_VERIFIED';
  const priceK = Math.round(profile.hourlyRateVnd / 1000);
  const ratingAvg = profile.ratingAvg ? Number(profile.ratingAvg) : null;

  const availByDay: Record<number, typeof availability> = {};
  for (const a of availability) {
    (availByDay[a.dayOfWeek] ??= []).push(a);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <Link
        href="/tutoring?tab=tutors"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại danh sách
      </Link>

      <header className="bg-card shadow-soft relative overflow-hidden rounded-2xl">
        <div className="from-primary/15 via-primary/5 relative h-20 overflow-hidden bg-gradient-to-br to-transparent">
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
              <Avatar className="ring-card h-20 w-20 ring-4">
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
                  className="bg-card absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full"
                >
                  <CheckCircle2
                    className="fill-primary text-primary-foreground h-5 w-5"
                    strokeWidth={2}
                  />
                </div>
              )}
            </div>
            <div className="min-w-0 space-y-1">
              <h1 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
                {profile.userName ?? 'Anonymous'}
              </h1>
              <p className="text-muted-foreground text-[13px] leading-relaxed">
                {profile.headline}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {isVerified && (
                  <span
                    title="Đã xác thực CCCD + bằng cấp"
                    className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                  >
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Đã xác thực
                  </span>
                )}
                {profile.instantBookEnabled && (
                  <span className="bg-discovery-500/10 text-discovery-700 dark:text-discovery-300 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold">
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

      <div className="grid items-start gap-5 md:grid-cols-[1fr_300px]">
        <aside className="order-first space-y-3 md:sticky md:top-5 md:order-last">
          <div className="border-divider bg-card shadow-soft rounded-2xl border p-4">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-semibold tabular-nums tracking-tight">{priceK}K</span>
              <span className="text-text-muted text-xs">vnd/giờ</span>
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
                className="border-divider bg-surface shadow-soft hover:bg-muted mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
              >
                Về dashboard
              </Link>
            )}

            <div className="border-divider mt-4 space-y-2 border-t pt-3">
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

        <main className="order-last min-w-0 space-y-5 md:order-first">
          <section>
            <SectionHeading>Giới thiệu</SectionHeading>
            <div className="bg-card shadow-soft rounded-xl p-5">
              <p className="text-foreground/85 whitespace-pre-wrap text-sm leading-relaxed">
                {profile.bio}
              </p>
            </div>
          </section>

          <section>
            <SectionHeading count={subjects.length}>Môn dạy</SectionHeading>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((s) => {
                const def = SUBJECT_BY_SLUG[s.subjectSlug];
                const isVer = s.verifiedAt !== null;
                return (
                  <div
                    key={s.id}
                    className="bg-card shadow-soft flex items-center gap-3 rounded-xl px-4 py-3"
                  >
                    <span className="text-2xl">{def?.emoji ?? '📚'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold tracking-tight">
                        {def?.name ?? s.subjectSlug}
                      </p>
                      <p className="text-text-muted text-[11px]">
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
                          className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
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

          <section>
            <SectionHeading>Khung giờ</SectionHeading>
            <div className="bg-card shadow-soft rounded-xl p-5">
              <div className="grid grid-cols-7 gap-2">
                {DAY_NAMES.map((day, i) => {
                  const slots = availByDay[i] ?? [];
                  return (
                    <div key={i} className="space-y-1.5">
                      <p className="text-text-muted text-center font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em]">
                        {day}
                      </p>
                      {slots.length === 0 ? (
                        <div className="border-divider text-text-muted/60 rounded-md border border-dashed py-2 text-center text-[10px]">
                          —
                        </div>
                      ) : (
                        slots.map((s) => (
                          <div
                            key={s.id}
                            className="bg-primary/10 text-primary rounded-md px-1 py-1 text-center font-mono text-[10.5px] tabular-nums"
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

          {profile.introVideoUrl && (
            <section>
              <SectionHeading>Video giới thiệu</SectionHeading>
              <div className="bg-card shadow-soft overflow-hidden rounded-2xl">
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

          {packs.length > 0 && !isOwner && (
            <section>
              <SectionHeading count={packs.length}>Pack giảm giá</SectionHeading>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {packs.map((p) => {
                  const subjDef = SUBJECT_BY_SLUG[p.subjectSlug];
                  return (
                    <div
                      key={p.id}
                      className="border-discovery-500/20 from-discovery-500/5 shadow-soft flex flex-col gap-2 rounded-2xl border bg-gradient-to-br to-transparent p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 text-[12px] font-semibold">
                          {subjDef?.emoji} {subjDef?.name ?? p.subjectSlug}
                        </span>
                        {p.discountPct > 0 && (
                          <span className="bg-discovery-500/15 text-discovery-700 dark:text-discovery-300 rounded-full px-2 py-0.5 text-[10px] font-bold">
                            -{p.discountPct}%
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold tracking-tight">
                        {p.sessionCount} buổi × {p.durationMin} phút
                      </p>
                      {p.description && (
                        <p className="text-muted-foreground line-clamp-2 text-[11.5px]">
                          {p.description}
                        </p>
                      )}
                      <div className="border-divider mt-auto flex items-end justify-between border-t pt-2.5">
                        <div>
                          <p className="font-mono text-lg font-semibold tabular-nums">
                            {(p.totalVnd / 1000).toLocaleString('vi-VN')}k
                          </p>
                          <p className="text-muted-foreground text-[10px]">
                            ≈ {(p.ratePerSessionVnd / 1000).toFixed(0)}k/buổi
                          </p>
                        </div>
                        <form action={`/api/tutoring/packs/${p.id}/purchase`} method="POST">
                          <button
                            type="submit"
                            className="bg-discovery-600 hover:bg-discovery-700 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white"
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

          {reviews.length > 0 && (
            <section>
              <SectionHeading count={reviews.length}>Đánh giá từ học sinh</SectionHeading>
              <ul className="space-y-2">
                {reviews.map((r) => (
                  <li key={r.id} className="bg-card shadow-soft rounded-xl p-4">
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
                                    : 'text-muted-foreground/30 h-3 w-3'
                                }
                              />
                            ))}
                          </span>
                          <span className="text-text-muted text-[10.5px]">
                            {new Date(r.createdAt).toLocaleDateString('vi-VN')}
                          </span>
                        </div>
                        {r.comment && (
                          <p className="text-foreground/85 mt-1 whitespace-pre-wrap text-sm leading-relaxed">
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
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[12px]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="text-right">
        <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
        {hint && <span className="text-text-muted ml-1 text-[10.5px]">{hint}</span>}
      </span>
    </div>
  );
}
