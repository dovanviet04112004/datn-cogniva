import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { PageShell } from '@/components/layout/page-shell';
import { CompareClient } from '@/components/tutoring/compare/compare-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ ids?: string }>;

export default async function ComparePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/tutoring/compare');

  const sp = await searchParams;
  const ids = (sp.ids ?? '').split(',').filter((id) => id.trim().length > 0);

  if (ids.length < 2) {
    return (
      <PageShell size="default" padded>
        <p className="text-muted-foreground text-sm">
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
        <p className="text-muted-foreground mt-1 text-sm">
          So sánh {ids.length} gia sư side-by-side. Giá trị tốt nhất được tô màu xanh.
        </p>
      </header>
      <CompareClient ids={ids} />
    </PageShell>
  );
}
