export type LibraryBadgeKey =
  | 'outcome_verified'
  | 'educator_approved'
  | 'syllabus_complete'
  | 'power_resource';

export const BADGE_META: Record<
  LibraryBadgeKey,
  { label: string; short: string; emoji: string; class: string; desc: string }
> = {
  outcome_verified: {
    label: 'Đã kiểm chứng',
    short: 'Kiểm chứng',
    emoji: '🏆',
    class: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    desc: 'Kết quả học tập đã được xác minh — user import doc này cải thiện điểm.',
  },
  educator_approved: {
    label: 'Giáo viên duyệt',
    short: 'GV duyệt',
    emoji: '✓',
    class: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    desc: 'Được giáo viên / gia sư xác nhận chất lượng.',
  },
  syllabus_complete: {
    label: 'Đủ chương trình',
    short: 'Đủ CT',
    emoji: '🎯',
    class: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    desc: 'Bao quát đủ nội dung chương trình của môn/cấp học.',
  },
  power_resource: {
    label: 'Tài liệu chất lượng',
    short: 'Chất lượng',
    emoji: '⚡',
    class: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    desc: 'Được nhiều người import + đánh giá cao.',
  },
};

export function badgeShortLabel(slug: string): string {
  return BADGE_META[slug as LibraryBadgeKey]?.short ?? slug.replace(/_/g, ' ');
}
