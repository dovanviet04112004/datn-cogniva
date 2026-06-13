import Link from 'next/link';
import { CheckCircle2, ChevronRight, Clock } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { apiServer } from '@/lib/api-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type KycQueueRow = {
  tutorId: string;
  tutorUserId: string;
  tutorName: string | null;
  tutorEmail: string;
  tutorAvatarUrl: string | null;
  headline: string;
  verificationStatus: string;
  pendingCount: number;
  totalCount: number;
  latestUpload: string;
};

export default async function AdminKycPage() {
  const { tutors: rows } = await apiServer<{ tutors: KycQueueRow[] }>('/api/admin/kyc');

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">KYC queue</h1>
        <p className="text-sm text-slate-400">
          List tutor đã upload KYC docs. Click để review từng file.
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Chưa có hồ sơ nào"
          description="Khi tutor upload CCCD/bằng cấp, hồ sơ sẽ hiện ở đây."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.tutorId}>
              <Link
                href={`/admin/tutoring/kyc/${r.tutorId}`}
                className="group/r flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4 transition-colors hover:border-slate-700 hover:bg-slate-900"
              >
                <Avatar className="h-11 w-11">
                  <AvatarImage src={r.tutorAvatarUrl ?? undefined} />
                  <AvatarFallback className="bg-slate-800 text-slate-200">
                    {(r.tutorName ?? '?')[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold tracking-tight text-slate-100">
                    {r.tutorName ?? 'Anonymous'}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">
                    {r.tutorEmail} · {r.headline}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.pendingCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-400 ring-1 ring-inset ring-amber-500/30">
                      <Clock className="h-3 w-3" />
                      {r.pendingCount} chờ
                    </span>
                  ) : r.verificationStatus === 'KYC_VERIFIED' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3" />
                      Verified
                    </span>
                  ) : (
                    <span className="text-[10.5px] text-slate-500">{r.totalCount} doc</span>
                  )}
                  <ChevronRight className="h-4 w-4 text-slate-600 group-hover/r:text-slate-300" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
