/**
 * /tutoring/compare?ids=a,b,c — V4 T5 (2026-05-22).
 *
 * Side-by-side comparison 2-4 tutor.
 *
 * Spec: docs/plans/tutoring-v4.md §7.6.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { PageShell } from '@/components/layout/page-shell';
import { CompareClient } from '@/components/tutoring/compare/compare-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ ids?: string }>;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?redirect=/tutoring/compare');

  const sp = await searchParams;
  const ids = (sp.ids ?? '').split(',').filter((id) => id.trim().length > 0);

  if (ids.length < 2) {
    return (
      <PageShell size="default" padded>
        <p className="text-sm text-muted-foreground">
          Cần chọn ≥ 2 gia sư để so sánh.{' '}
          <a href="/tutoring" className="text-primary underline">
            Quay lại
          </a>
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell size="wide" padded className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">So sánh gia sư</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          So sánh {ids.length} gia sư side-by-side. Giá trị tốt nhất được tô màu xanh.
        </p>
      </header>
      <CompareClient ids={ids} />
    </PageShell>
  );
}
