import { requireAdmin } from '@/lib/admin/guard';
import { apiServer } from '@/lib/api-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DashboardData = {
  userCount: number;
  docCount: number;
  recentAudit: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    adminId: string;
    createdAt: string;
  }>;
};

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  const { userCount, docCount, recentAudit } =
    await apiServer<DashboardData>('/api/admin/dashboard');

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-400">
          Xin chào, {admin.name ?? admin.email}. Đây là tổng quan hệ thống Cogniva.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricTile label="Total users" value={String(userCount)} hint={null} />
        <MetricTile label="Total documents" value={String(docCount)} hint={null} />
        <MetricTile label="AI cost today" value="—" hint="đang kết nối nguồn" />
        <MetricTile label="Errors 24h" value="—" hint="Sentry pending" />
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Audit log gần đây</h2>
          <a
            href="/admin/audit"
            className="text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-200"
          >
            Xem tất cả →
          </a>
        </div>
        {recentAudit.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-700 bg-slate-900/40 px-3 py-6 text-center text-xs text-slate-500">
            Chưa có hành động admin nào được ghi.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {recentAudit.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-2 text-xs">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-300">
                  {row.action}
                </span>
                <span className="text-slate-400">
                  {row.targetType} · <span className="font-mono">{row.targetId.slice(0, 12)}…</span>
                </span>
                <span className="ml-auto font-mono text-[10.5px] text-slate-500">
                  {new Date(row.createdAt).toLocaleString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint: string | null }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-slate-100">
        {value}
      </p>
      {hint && <p className="mt-1 text-[10.5px] text-slate-500">{hint}</p>}
    </div>
  );
}
