/**
 * DashboardQuickActions — lưới "Hành động nhanh" trên dashboard (client).
 *
 * Vì sao client: nút "Upload tài liệu" giờ MỞ HỘP THOẠI NGAY TẠI CHỖ (modal trên
 * dashboard) thay vì navigate sang /documents — pro UX, không rời trang. Cần
 * useState để điều khiển dialog → phải là client component.
 *
 * 3 hành động HỌC TẬP cốt lõi (đều "có tác dụng" thật, không đổ user ra trang trống):
 *   1. Upload  → mở UploadDocumentDialog inline; xong → router.refresh() cập nhật stats.
 *   2. Hỏi AI  → /workspaces/new-chat (route đảm bảo có workspace rồi vào thẳng chat).
 *   3. Ôn thẻ  → /flashcards/review (vào thẳng phiên ôn).
 *
 * Các mảng KHÁC của hệ thống (kho tài liệu, bản đồ KT, nhóm học, gia sư, đề thi,
 * phòng học) nằm ở section "Khám phá Cogniva" (ExploreGrid) — dùng chung với onboarding.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BrainCircuit,
  MessageSquare,
  Upload,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { UploadDocumentDialog } from '@/components/documents/upload-document-dialog';

export function DashboardQuickActions({
  cardsDue,
  totalDocs,
  tutorHref,
}: {
  cardsDue: number;
  totalDocs: number;
  /** Đích "Hỏi AI" — thường là /workspaces/new-chat (đảm bảo workspace). */
  tutorHref: string;
}) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = React.useState(false);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <QuickAction
          onClick={() => setUploadOpen(true)}
          icon={Upload}
          title={totalDocs === 0 ? 'Upload tài liệu đầu tiên' : 'Upload tài liệu'}
          description="Bật hộp thoại upload PDF ngay tại đây — không rời trang."
          accent="from-blue-500/20 to-blue-500/5"
          iconColor="text-blue-600 dark:text-blue-400"
          urgent={totalDocs === 0}
          urgentLabel="Bắt đầu tại đây"
        />
        <QuickAction
          href={tutorHref}
          icon={MessageSquare}
          title="Hỏi AI Tutor"
          description="Vào thẳng khung chat — tự tạo workspace nếu bạn chưa có."
          accent="from-primary/20 to-primary/5"
          iconColor="text-primary"
        />
        <QuickAction
          href="/flashcards/review"
          icon={BrainCircuit}
          title={cardsDue > 0 ? `Ôn ${cardsDue} thẻ ngay` : 'Ôn flashcard'}
          description={
            cardsDue > 0
              ? 'Thẻ tới hạn ôn hôm nay — chỉ vài phút để giữ kiến thức.'
              : 'Ôn lại kiến thức theo lịch thông minh — học đúng lúc sắp quên.'
          }
          accent={
            cardsDue > 0
              ? 'from-emerald-500/30 to-emerald-500/10'
              : 'from-emerald-500/20 to-emerald-500/5'
          }
          iconColor="text-emerald-600 dark:text-emerald-400"
          badge={cardsDue > 0 ? cardsDue : null}
          urgent={cardsDue > 0}
        />
      </div>

      {/* Hộp thoại upload — controlled, mở từ card Upload. Xong → refresh stats. */}
      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => router.refresh()}
      />
    </>
  );
}

/**
 * QuickAction — card hành động: icon gradient, hover lift + glow + sheen line.
 *
 * Nhận `href` (render <Link>) HOẶC `onClick` (render <button>, vd mở dialog inline).
 * `urgent` → ring + ribbon `urgentLabel` (tông primary) làm card ưu tiên nổi bật.
 */
function QuickAction({
  href,
  onClick,
  icon: Icon,
  title,
  description,
  accent,
  iconColor,
  badge,
  urgent,
  urgentLabel = 'Đề xuất hôm nay',
}: {
  href?: string;
  onClick?: () => void;
  icon: LucideIcon;
  title: string;
  description: string;
  accent: string;
  iconColor: string;
  badge?: number | null;
  urgent?: boolean;
  urgentLabel?: string;
}) {
  const className = cn(
    'group/qa relative overflow-hidden rounded-xl border text-left shadow-soft transition-all duration-base ease-expo-out hover:-translate-y-1 hover:shadow-elevated',
    urgent
      ? 'border-primary/40 bg-card ring-2 ring-primary/15 hover:border-primary/60'
      : 'border-divider bg-card hover:border-foreground/15',
  );

  const inner = (
    <>
      {/* Sheen line trên cùng — hiện khi hover, premium edge */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 transition-opacity duration-base group-hover/qa:opacity-100"
      />
      {urgent && (
        <span className="absolute right-0 top-0 z-10 inline-flex items-center gap-1 rounded-bl-xl bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-primary-foreground shadow-sm">
          {urgentLabel}
        </span>
      )}
      {/* Accent halo — sáng + nở khi hover */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gradient-to-br opacity-50 blur-2xl transition-all duration-base group-hover/qa:scale-110 group-hover/qa:opacity-100',
          accent,
        )}
      />
      <div className="relative flex h-full flex-col gap-3.5 p-5">
        <div className="flex items-start justify-between gap-2">
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset ring-border/50 transition-transform duration-base group-hover/qa:scale-105',
              accent,
              iconColor,
            )}
          >
            <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
          </div>
          {badge !== null && badge !== undefined && badge > 0 && (
            <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary-foreground shadow-sm">
              {badge}
            </span>
          )}
        </div>
        <div className="space-y-1">
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <ArrowRight className="mt-auto h-4 w-4 text-muted-foreground/40 transition-all group-hover/qa:translate-x-0.5 group-hover/qa:text-primary" />
      </div>
    </>
  );

  // onClick → <button> (mở dialog inline); href → <Link>.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }
  return (
    <Link href={href ?? '#'} className={className}>
      {inner}
    </Link>
  );
}
