/**
 * AdminPlaceholder — UI thống nhất cho các section admin chưa wire data.
 * Dùng cho Phase 0 skeleton để sidebar click không 404, đồng thời ghi rõ
 * Phase nào sẽ làm.
 */
import { Construction } from 'lucide-react';

export function AdminPlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-slate-400">{description}</p>
      </header>

      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/20">
          <Construction className="h-5 w-5" />
        </div>
        <h3 className="text-sm font-semibold tracking-tight text-slate-200">
          Đang xây dựng
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
          Section này sẽ được wire dữ liệu ở <span className="font-mono text-slate-300">{phase}</span>.
          Xem <span className="font-mono text-slate-300">docs/plans/admin.md</span> để biết chi tiết feature.
        </p>
      </div>
    </div>
  );
}
