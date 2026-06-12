import Link from 'next/link';
import { Sparkles, TrendingUp } from 'lucide-react';

import { apiServerOrNull } from '@/lib/api-server';
import { getServerT } from '@/lib/i18n/server';
import { SectionHeading } from '@/components/ui/section-heading';
import type { DocCardData } from './doc-card';

import { DocCarousel } from './doc-carousel';

export async function HubCuratedSections({ hasActiveSearch }: { hasActiveSearch: boolean }) {
  if (hasActiveSearch) return null;

  const t = await getServerT();
  const data = await apiServerOrNull<{ forYou: DocCardData[]; popular: DocCardData[] }>(
    '/api/library/hub-sections',
  );
  const forYou = data?.forYou ?? [];
  const popular = data?.popular ?? [];

  const sections: Array<{
    label: string;
    icon: typeof Sparkles;
    iconClass: string;
    docs: DocCardData[];
    href: string | null;
  }> = [];

  if (forYou.length > 0) {
    sections.push({
      label: t('library.curated.for_you'),
      icon: Sparkles,
      iconClass: 'text-discovery-500',
      docs: forYou,
      href: null,
    });
  } else if (popular.length > 0) {
    sections.push({
      label: t('library.curated.trending'),
      icon: TrendingUp,
      iconClass: 'text-rose-500',
      docs: popular,
      href: '/library?sort=popular',
    });
  }

  return (
    <div className="mb-6 space-y-5">
      {sections.map((sec) => {
        const Icon = sec.icon;
        return (
          <section key={sec.label}>
            <SectionHeading
              count={sec.docs.length}
              action={
                sec.href ? (
                  <Link
                    href={sec.href}
                    className="text-muted-foreground hover:text-primary text-[11px] font-medium"
                  >
                    {t('library.curated.see_all')}
                  </Link>
                ) : undefined
              }
            >
              <span className="inline-flex items-center gap-2">
                <Icon className={`h-3.5 w-3.5 ${sec.iconClass}`} />
                {sec.label}
              </span>
            </SectionHeading>
            <DocCarousel docs={sec.docs} />
          </section>
        );
      })}
    </div>
  );
}
