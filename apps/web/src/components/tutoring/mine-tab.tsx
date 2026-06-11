import Link from 'next/link';
import {
  Banknote,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FilePlus,
  GraduationCap,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react';

import { LEVEL_NAMES, MODALITY_NAMES, SUBJECT_BY_SLUG, URGENCY_NAMES } from '@cogniva/db';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/section-heading';
import { EarningsCard } from '@/components/tutoring/earnings-card';
import { RelativeTime } from '@/components/ui/relative-time';
import { getMineTab } from '@/lib/tutoring/get-mine-tab';
import { cn } from '@/lib/utils';

const URGENCY_COLORS: Record<string, string> = {
  ASAP: 'bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20',
  THIS_WEEK: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 ring-orange-500/20',
  THIS_MONTH: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-blue-500/20',
  FLEXIBLE: 'bg-muted/60 text-muted-foreground ring-border',
};

const REQUEST_STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20',
  MATCHED: 'bg-primary/10 text-primary ring-primary/20',
  CLOSED: 'bg-muted/60 text-muted-foreground ring-border',
};

const APP_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20',
  ACCEPTED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20',
  REJECTED: 'bg-muted/60 text-muted-foreground ring-border',
  WITHDRAWN: 'bg-muted/60 text-muted-foreground ring-border',
};

const REQUEST_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Đang mở',
  MATCHED: 'Đã match',
  CLOSED: 'Đã đóng',
};

const APP_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Đang đợi',
  ACCEPTED: 'Đã được chọn',
  REJECTED: 'Bị từ chối',
  WITHDRAWN: 'Đã huỷ',
};

export async function MineTab({ userId }: { userId: string }) {
  const { myProfile, myRequests, upcomingBookings, myApplications } = await getMineTab(userId);

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading>Hồ sơ gia sư</SectionHeading>

        {myProfile ? (
          <Link
            href={`/tutors/${myProfile.id}`}
            className="group/p bg-card shadow-soft hover:shadow-elevated flex items-center gap-4 rounded-2xl p-5 transition-all hover:-translate-y-0.5"
          >
            <Avatar className="ring-primary/15 h-14 w-14 ring-2">
              <AvatarImage src={myProfile.avatarUrl ?? undefined} />
              <AvatarFallback className="text-base font-semibold">
                <GraduationCap className="text-primary h-6 w-6" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-base font-semibold tracking-tight">
                  {myProfile.headline}
                </p>
                {myProfile.verificationStatus === 'KYC_VERIFIED' && (
                  <CheckCircle2 className="fill-primary text-primary-foreground h-4 w-4 shrink-0" />
                )}
              </div>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset',
                    myProfile.status === 'PUBLISHED'
                      ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400'
                      : myProfile.status === 'DRAFT'
                        ? 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400'
                        : 'bg-muted/60 text-muted-foreground ring-border',
                  )}
                >
                  {myProfile.status === 'PUBLISHED'
                    ? 'Đang hoạt động'
                    : myProfile.status === 'DRAFT'
                      ? 'Bản nháp'
                      : 'Tạm dừng'}
                </span>
                <span className="font-mono tabular-nums">
                  {Math.round(myProfile.hourlyRateVnd / 1000)}K vnd/giờ
                </span>
                <span>·</span>
                <span>{MODALITY_NAMES[myProfile.modality]}</span>
                <span>·</span>
                <span className="font-mono tabular-nums">
                  {myProfile.sessionsCompleted} buổi dạy
                </span>
              </div>
            </div>
            <span className="border-divider bg-surface text-muted-foreground group-hover/p:bg-muted group-hover/p:text-foreground inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors">
              <Pencil className="h-3.5 w-3.5" />
              Quản lý
            </span>
          </Link>
        ) : (
          <Link
            href="/tutors/become"
            className="group/c border-divider bg-card/40 hover:bg-card hover:shadow-soft flex items-center gap-4 rounded-2xl border border-dashed p-5 transition-all"
          >
            <div className="bg-primary/10 text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
              <UserPlus className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold tracking-tight">Trở thành gia sư</p>
              <p className="text-muted-foreground mt-0.5 text-[11.5px]">
                Setup profile 3 bước (Bio · Môn · Lịch) — học sinh sẽ tìm thấy bạn ngay sau khi
                publish.
              </p>
            </div>
            <ChevronRight className="text-muted-foreground/50 group-hover/c:text-foreground h-4 w-4 transition-all group-hover/c:translate-x-0.5" />
          </Link>
        )}

        {myProfile && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Link
              href="/tutors/me/kyc"
              className="group/k bg-card shadow-soft hover:shadow-elevated flex items-center gap-3 rounded-xl px-4 py-3 transition-all hover:-translate-y-0.5"
            >
              <ShieldCheck className="text-primary h-4 w-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold tracking-tight">KYC danh tính</p>
                <p className="text-muted-foreground truncate text-[11px]">
                  {myProfile.verificationStatus === 'KYC_VERIFIED'
                    ? 'Đã xác thực ✓'
                    : myProfile.verificationStatus === 'KYC_PENDING'
                      ? 'Chờ admin duyệt...'
                      : 'Upload CCCD + bằng cấp'}
                </p>
              </div>
              <ChevronRight className="text-muted-foreground/40 group-hover/k:text-foreground h-3.5 w-3.5" />
            </Link>
            <a
              href="#earnings"
              className="group/e bg-card shadow-soft hover:shadow-elevated flex items-center gap-3 rounded-xl px-4 py-3 transition-all hover:-translate-y-0.5"
            >
              <Banknote className="text-primary h-4 w-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold tracking-tight">Earnings & Payout</p>
                <p className="text-muted-foreground truncate text-[11px]">
                  Xem thu nhập + rút tiền
                </p>
              </div>
              <ChevronRight className="text-muted-foreground/40 group-hover/e:text-foreground h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </section>

      <section>
        <Link
          href="/tutoring?tab=orders"
          className="border-divider bg-card shadow-soft hover:border-primary/30 group flex items-center gap-3 rounded-2xl border p-4 transition-colors"
        >
          <span className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <Calendar className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-tight">Đơn học của bạn</p>
            <p className="text-muted-foreground text-[12px]">
              {upcomingBookings.length > 0
                ? `${upcomingBookings.length} buổi sắp tới · quản lý theo trạng thái`
                : 'Xem & quản lý đơn theo trạng thái'}
            </p>
          </div>
          <ChevronRight className="text-muted-foreground/40 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </section>

      {myProfile && (
        <section id="earnings">
          <SectionHeading>Thu nhập & Rút tiền</SectionHeading>
          <EarningsCard />
        </section>
      )}

      {myProfile && (
        <section>
          <SectionHeading
            count={myApplications.length}
            action={
              <Link
                href="/tutoring?tab=requests"
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                Browse yêu cầu mới →
              </Link>
            }
          >
            Đơn đã apply
          </SectionHeading>

          {myApplications.length === 0 ? (
            <div className="border-divider bg-card/40 rounded-2xl border border-dashed p-6 text-center">
              <Sparkles className="text-muted-foreground/50 mx-auto mb-2 h-5 w-5" />
              <p className="text-sm font-medium">Chưa apply yêu cầu nào</p>
              <p className="text-muted-foreground mx-auto mt-1 max-w-md text-[11.5px]">
                Browse các yêu cầu học đang mở — apply nhanh để học sinh chọn.
              </p>
              <Link
                href="/tutoring?tab=requests"
                className="text-primary mt-3 inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
              >
                Xem yêu cầu
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {myApplications.map((a) => {
                const subjectDef = SUBJECT_BY_SLUG[a.requestSubject];
                const rateK = Math.round(a.proposedRateVnd / 1000);
                return (
                  <li key={a.id}>
                    <Link
                      href={`/tutoring/requests/${a.requestId}`}
                      className="group/a bg-card shadow-soft hover:shadow-elevated flex items-center gap-3 rounded-xl px-4 py-3 transition-all hover:-translate-y-0.5"
                    >
                      <span className="text-xl">{subjectDef?.emoji ?? '📚'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold tracking-tight">
                          {a.requestTitle}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-[11px]">
                          {subjectDef?.name ?? a.requestSubject} ·{' '}
                          {LEVEL_NAMES[a.requestLevel as keyof typeof LEVEL_NAMES]} ·{' '}
                          <span className="font-mono tabular-nums">{rateK}K/giờ</span>
                        </p>
                      </div>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                          APP_STATUS_COLORS[a.status] ?? APP_STATUS_COLORS.PENDING,
                        )}
                      >
                        {APP_STATUS_LABELS[a.status] ?? a.status}
                      </span>
                      <span className="text-text-muted text-[11px]">
                        <RelativeTime date={a.createdAt.toISOString()} />
                      </span>
                      <ChevronRight className="text-muted-foreground/40 group-hover/a:text-muted-foreground h-3.5 w-3.5 transition-all group-hover/a:translate-x-0.5" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section>
        <SectionHeading
          count={myRequests.length}
          action={
            <Button asChild size="sm">
              <Link href="/tutoring/requests/new">
                <Plus className="h-3 w-3" />
                Đăng yêu cầu
              </Link>
            </Button>
          }
        >
          Yêu cầu của tôi
        </SectionHeading>

        {myRequests.length === 0 ? (
          <div className="border-divider bg-card/40 rounded-2xl border border-dashed p-6 text-center">
            <FilePlus className="text-muted-foreground/50 mx-auto mb-2 h-5 w-5" />
            <p className="text-sm font-medium">Chưa đăng yêu cầu nào</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-[11.5px]">
              Mô tả nhu cầu học của bạn — gia sư sẽ apply ngược trong 24h.
            </p>
            <Link
              href="/tutoring/requests/new"
              className="text-primary mt-3 inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
            >
              Đăng yêu cầu đầu tiên
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {myRequests.map((r) => {
              const subjectDef = SUBJECT_BY_SLUG[r.subjectSlug];
              const budgetK = r.budgetVnd ? Math.round(r.budgetVnd / 1000) : null;
              return (
                <li key={r.id}>
                  <Link
                    href={`/tutoring/requests/${r.id}`}
                    className="group/r bg-card shadow-soft hover:shadow-elevated flex items-center gap-3 rounded-xl px-4 py-3 transition-all hover:-translate-y-0.5"
                  >
                    <span className="text-xl">{subjectDef?.emoji ?? '📚'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold tracking-tight">{r.title}</p>
                      <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span>
                          {subjectDef?.name ?? r.subjectSlug} ·{' '}
                          {LEVEL_NAMES[r.level as keyof typeof LEVEL_NAMES]}
                        </span>
                        <span>·</span>
                        <span>{MODALITY_NAMES[r.modality]}</span>
                        {budgetK !== null && (
                          <>
                            <span>·</span>
                            <span className="font-mono tabular-nums">≤{budgetK}K</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                        URGENCY_COLORS[r.urgency] ?? URGENCY_COLORS.FLEXIBLE,
                      )}
                    >
                      <Clock className="mr-1 h-2.5 w-2.5" />
                      {URGENCY_NAMES[r.urgency]}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                        REQUEST_STATUS_COLORS[r.status] ?? REQUEST_STATUS_COLORS.OPEN,
                      )}
                    >
                      {REQUEST_STATUS_LABELS[r.status] ?? r.status}
                    </span>
                    <ChevronRight className="text-muted-foreground/40 group-hover/r:text-muted-foreground h-3.5 w-3.5 transition-all group-hover/r:translate-x-0.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
