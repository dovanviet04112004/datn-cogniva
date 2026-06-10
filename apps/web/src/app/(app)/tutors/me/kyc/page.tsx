/**
 * /tutors/me/kyc — tutor upload + theo dõi KYC documents.
 */
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { ChevronLeft, ShieldCheck } from 'lucide-react';

import { db, tutorKycDocument, tutorProfile } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { KycUploadForm } from '@/components/tutoring/kyc-upload-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function KycPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?redirect=/tutors/me/kyc');

  const [profile] = await db
    .select()
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);
  if (!profile) redirect('/tutors/become');

  const docs = await db
    .select()
    .from(tutorKycDocument)
    .where(eq(tutorKycDocument.tutorId, profile.id))
    .orderBy(desc(tutorKycDocument.createdAt));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <Link
        href="/tutoring?tab=mine"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Về dashboard
      </Link>

      <header className="rounded-2xl bg-gradient-to-br from-card via-card to-surface-secondary p-6 shadow-soft">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Xác thực danh tính
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight">
          KYC tutor
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Upload CCCD + bằng cấp để được Cogniva xét duyệt. Sau khi
          KYC_VERIFIED, profile có badge xanh + được phép rút tiền earnings.
        </p>
        <p className="mt-3 text-[11.5px]">
          Trạng thái hiện tại:{' '}
          <span className="font-mono font-semibold">
            {profile.verificationStatus}
          </span>
        </p>
      </header>

      <KycUploadForm
        tutorId={profile.id}
        initialDocs={docs.map((d) => ({
          id: d.id,
          docType: d.docType,
          storageKey: d.storageKey,
          originalName: d.originalName,
          status: d.status,
          reviewNote: d.reviewNote,
          createdAt: d.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
