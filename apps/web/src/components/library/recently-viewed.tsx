import { Clock } from 'lucide-react';

import { apiServerOrNull } from '@/lib/api-server';
import { getServerSession } from '@/lib/auth-server';
import { getServerT } from '@/lib/i18n/server';
import { SectionHeading } from '@/components/ui/section-heading';

import type { DocCardData } from './doc-card';
import { DocCarousel } from './doc-carousel';

export async function RecentlyViewed() {
  const session = await getServerSession();
  if (!session?.user.id) return null;

  const res = await apiServerOrNull<{ docs: DocCardData[] }>('/api/library/recently-viewed');
  const docs = res?.docs ?? [];

  if (docs.length === 0) return null;

  const t = await getServerT();

  return (
    <section className="mb-5">
      <SectionHeading count={docs.length}>
        <span className="inline-flex items-center gap-2">
          <Clock className="text-discovery-500 h-3.5 w-3.5" />
          {t('library.recent.title')}
        </span>
      </SectionHeading>
      <DocCarousel docs={docs} />
    </section>
  );
}
