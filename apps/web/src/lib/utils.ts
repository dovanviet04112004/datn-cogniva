/**
 * Hàm tiện ích cho UI — gom các util nhỏ, không phụ thuộc framework.
 * File này được import từ khắp nơi (cả client + server component) nên KHÔNG
 * bao giờ thêm side-effect ở module level.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Ghép class Tailwind một cách an toàn:
 *  - clsx xử lý conditional class (`{ 'is-active': isActive }`).
 *  - twMerge giải quyết conflict (ví dụ `px-2` + `px-4` → giữ `px-4`).
 *
 * @example
 *   cn('px-2 py-1', isLarge && 'px-4', className)
 *   // → 'py-1 px-4 ...'
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format số thành chuỗi có dấu phân tách hàng nghìn theo locale en-US.
 * Dùng cho các stat hiển thị (số tài liệu, số thẻ flashcard…).
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Trả về thời gian dạng tương đối, ví dụ "5m ago", "2d ago", "3/5/2026".
 *
 * Quy tắc:
 *   < 60s   → "just now"
 *   < 1h    → phút
 *   < 1 ngày→ giờ
 *   < 7 ngày→ ngày
 *   xa hơn → ngày tháng đầy đủ theo locale của browser
 *
 * @param date - Date object hoặc chuỗi ISO 8601
 */
export function formatRelativeTime(date: Date | string): string {
  const target = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - target.getTime();
  const diffSec = Math.round(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return target.toLocaleDateString();
}
