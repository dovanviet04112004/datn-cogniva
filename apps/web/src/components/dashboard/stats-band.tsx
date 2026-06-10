/**
 * DashboardStatsBand — DẢI thống kê ngang liền mạch (thay 4 "ô vuông + số").
 *
 * Vì sao đổi: 4 KPI là số ĐẾM thuần (tài liệu/thẻ/hội thoại) + XP — theo ui-ux-pro
 * (chart domain) số đếm hợp "stat sạch", chỉ metric có-mục-tiêu mới hợp gauge/vòng;
 * trộn vòng cho số đếm sẽ rối. Pattern phổ biến + premium nhất cho cụm KPI loại này
 * là DẢI THỐNG KÊ NGANG (Linear/Vercel/Stripe): 1 card liền, các mục chia bằng vạch
 * mảnh, mỗi mục = icon màu + số to + nhãn + ngữ cảnh + thanh accent đáy. Hết cảm
 * giác "4 ô vuông rời". Responsive: mobile xếp dọc (list), desktop nằm ngang.
 *
 * Presentational (server-safe). Token theo design-system/MASTER.md.
 */
import {
  BrainCircuit,
  FileText,
  MessageSquare,
  Trophy,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

type Seg = {
  icon: LucideIcon;
  value: number;
  label: string;
  sub: string;
  /** Nền badge icon (tint nhạt). */
  tint: string;
  /** Màu icon. */
  tintText: string;
  /** Màu thanh accent đáy (đặc). */
  bar: string;
};

export function DashboardStatsBand({
  totalDocs,
  cardsDue,
  totalConv,
  xp,
  streak,
}: {
  totalDocs: number;
  cardsDue: number;
  totalConv: number;
  xp: number;
  streak: number;
}) {
  const segs: Seg[] = [
    {
      icon: FileText,
      value: totalDocs,
      label: 'Tài liệu',
      sub: totalDocs > 0 ? 'đã index' : 'chưa có',
      tint: 'bg-blue-500/12',
      tintText: 'text-blue-600 dark:text-blue-400',
      bar: 'bg-blue-500',
    },
    {
      icon: BrainCircuit,
      value: cardsDue,
      label: 'Thẻ cần ôn',
      sub: cardsDue === 0 ? 'queue rỗng' : 'tới hạn hôm nay',
      tint: 'bg-emerald-500/12',
      tintText: 'text-emerald-600 dark:text-emerald-400',
      bar: 'bg-emerald-500',
    },
    {
      icon: MessageSquare,
      value: totalConv,
      label: 'Hội thoại AI',
      sub: totalConv > 0 ? 'phiên chat' : 'chưa có',
      tint: 'bg-discovery-500/12',
      tintText: 'text-discovery-600 dark:text-discovery-400',
      bar: 'bg-discovery-500',
    },
    {
      icon: Trophy,
      value: xp,
      label: 'XP',
      sub: streak > 0 ? `${streak} ngày streak` : 'bắt đầu streak',
      tint: 'bg-orange-500/12',
      tintText: 'text-orange-600 dark:text-orange-400',
      bar: 'bg-orange-500',
    },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-divider bg-card/70 shadow-soft backdrop-blur-sm">
      {/* Sheen line mép trên — premium edge. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent"
      />
      <div className="grid grid-cols-1 divide-y divide-divider sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        {segs.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="group/seg relative flex items-center gap-3 px-4 py-4 transition-colors duration-base hover:bg-foreground/[0.025] sm:px-5"
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-border/50 transition-transform duration-base group-hover/seg:scale-105',
                  s.tint,
                  s.tintText,
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-2xl font-bold tabular-nums leading-none tracking-tight">
                  {s.value.toLocaleString('vi-VN')}
                </p>
                <p className="mt-1.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {s.label}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-text-muted">{s.sub}</p>
              </div>
              {/* Thanh accent đáy — chỉ báo màu domain, sáng lên khi hover. */}
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute bottom-0 left-4 right-4 h-0.5 rounded-full opacity-35 transition-opacity duration-base group-hover/seg:opacity-80 sm:left-5 sm:right-5',
                  s.bar,
                )}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
