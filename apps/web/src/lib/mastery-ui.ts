/**
 * mastery-ui — map MasteryLevel (logic THUẦN ở @cogniva/shared/domain) sang
 * class Tailwind cho web.
 *
 * Vì sao tách: domain ở shared phải RN-safe (không Tailwind). Phần style web để
 * riêng đây → mọi chỗ hiển thị trạng thái atom (sources-panel, atom preview, …)
 * dùng CHUNG bảng này thay vì tự hardcode ngưỡng/màu → nhất quán, dễ đổi 1 chỗ.
 * Mobile có bản map riêng (StyleSheet) khi build, cùng `getMasteryLevel`.
 */
import {
  getMasteryLevel,
  MASTERY_LEVEL_LABEL,
  type MasteryLevel,
} from '@cogniva/shared/domain';

export { getMasteryLevel, MASTERY_LEVEL_LABEL, type MasteryLevel };

/** Style theo level: dot (chấm), chip (badge nền), bar (thanh tiến độ), text (chữ %). */
export const MASTERY_LEVEL_STYLE: Record<
  MasteryLevel,
  { dot: string; chip: string; bar: string; text: string }
> = {
  new: {
    dot: 'bg-slate-400',
    chip: 'bg-muted text-muted-foreground',
    bar: 'bg-slate-400',
    text: 'text-muted-foreground',
  },
  learning: {
    dot: 'bg-warning',
    chip: 'bg-warning/10 text-warning',
    bar: 'bg-warning',
    text: 'text-warning',
  },
  mastered: {
    dot: 'bg-success',
    chip: 'bg-success/10 text-success',
    bar: 'bg-success',
    text: 'text-success',
  },
};
