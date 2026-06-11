import { getMasteryLevel, MASTERY_LEVEL_LABEL, type MasteryLevel } from '@cogniva/shared/domain';

export { getMasteryLevel, MASTERY_LEVEL_LABEL, type MasteryLevel };

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
