import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { ChevronLeft, FileText } from 'lucide-react';

import { db, tutorKycDocument, tutorProfile, user as userTable } from '@cogniva/db';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { KycDocActions } from '@/components/admin/kyc-doc-actions';
import { cn } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const DOC_TYPE_LABEL: Record<string, string> = {
  CCCD_FRONT: 'CCCD mặt trước',
  CCCD_BACK: 'CCCD mặt sau',
  DEGREE: 'Bằng cấp',
  CERTIFICATE: 'Chứng chỉ',
  OTHER: 'Khác',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
  APPROVED: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
  REJECTED: 'bg-red-500/10 text-red-400 ring-red-500/20',
};

export default async function AdminKycDetailPage({ params }: Params) {
  const { id } = await params;

  const [profile] = await db
    .select({
      id: tutorProfile.id,
      headline: tutorProfile.headline,
      bio: tutorProfile.bio,
      verificationStatus: tutorProfile.verificationStatus,
      avatarUrl: tutorProfile.avatarUrl,
      userName: userTable.name,
      userEmail: userTable.email,
      userImage: userTable.image,
    })
    .from(tutorProfile)
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(eq(tutorProfile.id, id))
    .limit(1);

  if (!profile) notFound();

  const docs = await db
    .select()
    .from(tutorKycDocument)
    .where(eq(tutorKycDocument.tutorId, id))
    .orderBy(desc(tutorKycDocument.createdAt));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <Link
        href="/admin/tutoring/kyc"
        className="inline-flex items-center gap-1 text-sm text-slate-400 transition-colors hover:text-slate-200"
      >
        <ChevronLeft className="h-4 w-4" />
        Về queue
      </Link>

      <header className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-start gap-3">
          <Avatar className="h-14 w-14">
            <AvatarImage src={profile.avatarUrl ?? profile.userImage ?? undefined} />
            <AvatarFallback className="bg-slate-800 text-slate-200">
              {(profile.userName ?? '?')[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-slate-100">
              {profile.userName ?? 'Anonymous'}
            </h1>
            <p className="text-[11.5px] text-slate-400">{profile.userEmail}</p>
            <p className="mt-1 text-sm text-slate-300">{profile.headline}</p>
          </div>
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10.5px] font-semibold ring-1 ring-inset',
              profile.verificationStatus === 'KYC_VERIFIED'
                ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
            )}
          >
            {profile.verificationStatus}
          </span>
        </div>
      </header>

      <ul className="space-y-3">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-400">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold tracking-tight text-slate-100">
                {DOC_TYPE_LABEL[d.docType] ?? d.docType}
              </p>
              <p className="truncate font-mono text-[11px] text-slate-400">{d.originalName}</p>
              <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-slate-500">
                {(d.sizeBytes / 1024).toFixed(0)} KB · uploaded{' '}
                {d.createdAt.toLocaleString('vi-VN')}
              </p>
              <p className="mt-1 font-mono text-[10px] text-slate-500">storage: {d.storageKey}</p>
              {d.reviewNote && (
                <p className="mt-1 text-[11.5px] text-amber-400">Note: {d.reviewNote}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset',
                  STATUS_COLORS[d.status] ?? STATUS_COLORS.PENDING,
                )}
              >
                {d.status}
              </span>
              <KycDocActions docId={d.id} currentStatus={d.status} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
