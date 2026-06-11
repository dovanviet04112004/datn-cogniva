import { BrainCircuit, FileText, MessageSquare, Trophy, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

type Seg = {
  icon: LucideIcon;
  value: number;
  label: string;
  sub: string;
  tint: string;
  tintText: string;
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
    <div className="border-divider bg-card/70 shadow-soft relative overflow-hidden rounded-2xl border backdrop-blur-sm">
      <span
        aria-hidden
        className="via-foreground/10 pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
      />
      <div className="divide-divider grid grid-cols-1 divide-y sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        {segs.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="group/seg duration-base hover:bg-foreground/[0.025] relative flex items-center gap-3 px-4 py-4 transition-colors sm:px-5"
            >
              <span
                className={cn(
                  'ring-border/50 duration-base flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition-transform group-hover/seg:scale-105',
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
                <p className="text-muted-foreground mt-1.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em]">
                  {s.label}
                </p>
                <p className="text-text-muted mt-0.5 truncate text-[11px]">{s.sub}</p>
              </div>
              <span
                aria-hidden
                className={cn(
                  'duration-base pointer-events-none absolute bottom-0 left-4 right-4 h-0.5 rounded-full opacity-35 transition-opacity group-hover/seg:opacity-80 sm:left-5 sm:right-5',
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
