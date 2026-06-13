export const DOMAIN_LABELS: Record<string, string> = {
  math: 'Toán',
  cs: 'Khoa học máy tính',
  physics: 'Vật lý',
  chemistry: 'Hóa học',
  biology: 'Sinh học',
  history: 'Lịch sử',
  language: 'Ngôn ngữ',
  business: 'Kinh doanh',
  general: 'Khác',
  unknown: 'Chưa phân loại',
};

export const DOMAIN_DOT: Record<string, string> = {
  math: 'bg-blue-500',
  cs: 'bg-purple-500',
  physics: 'bg-orange-500',
  chemistry: 'bg-pink-500',
  biology: 'bg-green-500',
  history: 'bg-amber-500',
  language: 'bg-rose-500',
  business: 'bg-emerald-500',
};

export const DOMAIN_CARD: Record<string, string> = {
  math: 'border-blue-500/60 bg-blue-500/15',
  cs: 'border-purple-500/60 bg-purple-500/15',
  physics: 'border-orange-500/60 bg-orange-500/15',
  chemistry: 'border-pink-500/60 bg-pink-500/15',
  biology: 'border-green-500/60 bg-green-500/15',
  history: 'border-amber-500/60 bg-amber-500/15',
  language: 'border-rose-500/60 bg-rose-500/15',
  business: 'border-emerald-500/60 bg-emerald-500/15',
  general: 'border-slate-500/60 bg-slate-500/15',
};

export const DOMAIN_MINIMAP: Record<string, string> = {
  math: '#3b82f6',
  cs: '#a855f7',
  physics: '#f97316',
  chemistry: '#ec4899',
  biology: '#22c55e',
  history: '#f59e0b',
  language: '#f43f5e',
  business: '#10b981',
};

export function masteryDotClass(mastery: number | undefined): string {
  if (mastery === undefined) return 'bg-muted-foreground/40';
  if (mastery >= 0.7) return 'bg-green-500';
  if (mastery >= 0.3) return 'bg-yellow-500';
  return 'bg-red-500';
}
