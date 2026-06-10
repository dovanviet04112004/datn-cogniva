/**
 * ExploreGrid — dải "Khám phá Cogniva" DÙNG CHUNG (onboarding + dashboard).
 *
 * Vì sao tách: dashboard từng chỉ toàn action HỌC TẬP, trong khi hệ thống còn
 * Kho tài liệu / Nhóm học / Gia sư / Đề thi / Phòng học. User muốn dashboard bày
 * ĐỦ mảng + NHẤT QUÁN với dải "Cogniva còn có" lúc onboarding → 1 component chung,
 * 1 nguồn danh sách. Onboarding (user mới) dùng tập rút gọn an toàn; dashboard
 * (đã có data) dùng đủ mảng.
 *
 * Presentational (chỉ <Link>) → server-safe. Token theo design-system/MASTER.md.
 */
import Link from 'next/link';
import {
  ChevronRight,
  GraduationCap,
  Library,
  Share2,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type Capability = {
  icon: LucideIcon;
  label: string;
  desc: string;
  href: string;
};

/**
 * CHỈ liệt kê mảng VÀO ĐƯỢC NGAY (route render thẳng, không redirect/bait):
 *   library · graph · groups · tutoring.
 * CỐ Ý BỎ "Đề thi" (/exams → redirect /workspaces) + "Phòng học" (/rooms → redirect
 * /groups): 2 cái này nằm BÊN TRONG workspace/nhóm, bấm thẳng chỉ bị bounce → gây
 * bí (vi phạm quy tắc quick-action: CTA phải vào action thật). Đề thi vào qua
 * Studio trong workspace; phòng học vào qua 1 nhóm cụ thể.
 */
export const EXPLORE_CAPABILITIES: Capability[] = [
  { icon: Library, label: 'Kho tài liệu', desc: 'Tài liệu cộng đồng', href: '/library' },
  { icon: Share2, label: 'Bản đồ kiến thức', desc: 'Knowledge graph', href: '/graph' },
  { icon: Users, label: 'Nhóm học', desc: 'Học nhóm realtime', href: '/groups' },
  { icon: GraduationCap, label: 'Gia sư', desc: 'Đặt lịch 1-1', href: '/tutoring' },
];

export function ExploreGrid({
  items,
  gridClassName = 'grid-cols-2 sm:grid-cols-4',
}: {
  items?: Capability[];
  gridClassName?: string;
}) {
  const caps = items ?? EXPLORE_CAPABILITIES;
  return (
    <div className={cn('grid gap-2', gridClassName)}>
      {caps.map((c) => {
        const CIcon = c.icon;
        return (
          <Link
            key={c.label}
            href={c.href}
            className="group/cap flex items-center gap-2.5 rounded-xl border border-divider bg-surface px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-muted/50"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-discovery-500/10 text-discovery-600 transition-colors group-hover/cap:bg-discovery-500/15 dark:text-discovery-400">
              <CIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{c.label}</p>
              <p className="truncate text-[11px] text-muted-foreground">{c.desc}</p>
            </div>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-all group-hover/cap:translate-x-0.5 group-hover/cap:text-primary" />
          </Link>
        );
      })}
    </div>
  );
}
