'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, BrainCircuit, MessageSquare, Upload, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { UploadDocumentDialog } from '@/components/documents/upload-document-dialog';

export function DashboardQuickActions({
  cardsDue,
  totalDocs,
  tutorHref,
}: {
  cardsDue: number;
  totalDocs: number;
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

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => router.refresh()}
      />
    </>
  );
}

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
    'group/qa shadow-soft duration-base ease-expo-out hover:shadow-elevated relative overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-1',
    urgent
      ? 'border-primary/40 bg-card ring-primary/15 hover:border-primary/60 ring-2'
      : 'border-divider bg-card hover:border-foreground/15',
  );

  const inner = (
    <>
      <span
        aria-hidden
        className="via-primary/50 duration-base pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent opacity-0 transition-opacity group-hover/qa:opacity-100"
      />
      {urgent && (
        <span className="bg-primary text-primary-foreground absolute right-0 top-0 z-10 inline-flex items-center gap-1 rounded-bl-xl px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] shadow-sm">
          {urgentLabel}
        </span>
      )}
      <div
        aria-hidden
        className={cn(
          'duration-base pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gradient-to-br opacity-50 blur-2xl transition-all group-hover/qa:scale-110 group-hover/qa:opacity-100',
          accent,
        )}
      />
      <div className="relative flex h-full flex-col gap-3.5 p-5">
        <div className="flex items-start justify-between gap-2">
          <div
            className={cn(
              'ring-border/50 duration-base flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset transition-transform group-hover/qa:scale-105',
              accent,
              iconColor,
            )}
          >
            <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
          </div>
          {badge !== null && badge !== undefined && badge > 0 && (
            <span className="bg-primary text-primary-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums shadow-sm">
              {badge}
            </span>
          )}
        </div>
        <div className="space-y-1">
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
        </div>
        <ArrowRight className="text-muted-foreground/40 group-hover/qa:text-primary mt-auto h-4 w-4 transition-all group-hover/qa:translate-x-0.5" />
      </div>
    </>
  );

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
