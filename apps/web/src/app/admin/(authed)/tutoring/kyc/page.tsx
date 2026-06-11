import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { CheckCircle2, ChevronRight, Clock } from 'lucide-react';

import { db, tutorKycDocument, tutorProfile, user as userTable } from '@cogniva/db';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminKycPage() {
  const rows = await db
    .select({
      tutorId: tutorProfile.id,
      tutorUserId: tutorProfile.userId,
      tutorName: userTable.name,
      tutorEmail: userTable.email,
      tutorAvatarUrl: tutorProfile.avatarUrl,
      headline: tutorProfile.headline,
      verificationStatus: tutorProfile.verificationStatus,
      pendingCount: sql<number>`COUNT(CASE WHEN ${tutorKycDocument.status} = 'PENDING' THEN 1 END)::int`,
      totalCount: sql<number>`COUNT(${tutorKycDocument.id})::int`,
      latestUpload: sql<Date>`MAX(${tutorKycDocument.createdAt})`,
    })
    .from(tutorKycDocument)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutorKycDocument.tutorId))
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .groupBy(
      tutorProfile.id,
      tutorProfile.userId,
      userTable.name,
      userTable.email,
      tutorProfile.avatarUrl,
      tutorProfile.headline,
      tutorProfile.verificationStatus,
    )
    .orderBy(desc(sql`MAX(${tutorKycDocument.createdAt})`))
    .limit(50);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">KYC queue</h1>
        <p className="text-sm text-slate-400">
          List tutor đã upload KYC docs. Click để review từng file.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-12 text-center">
          <Clock className="mx-auto mb-2 h-6 w-6 text-slate-500" />
          <p className="text-sm font-medium text-slate-300">Chưa có hồ sơ nào</p>
          <p className="mt-1 text-xs text-slate-500">
            Khi tutor upload CCCD/bằng cấp, hồ sơ sẽ hiện ở đây.
          </p>
        </div>
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
