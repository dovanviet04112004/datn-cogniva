import Link from 'next/link';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { Sparkles, TrendingUp } from 'lucide-react';

import { db, libraryDoc, libraryDocImport, libraryDocView, user as userTable } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { getServerT } from '@/lib/i18n/server';
import { docCardColumns, toDocCardData } from '@/lib/library/doc-card-data';
import { SectionHeading } from '@/components/ui/section-heading';
import type { DocCardData } from './doc-card';

import { DocCarousel } from './doc-carousel';

async function fetchCurated(
  orderBySql: ReturnType<typeof desc> | ReturnType<typeof desc>[],
  whereExtra?: ReturnType<typeof eq> | ReturnType<typeof sql<unknown>>,
): Promise<DocCardData[]> {
  const conds: Array<ReturnType<typeof eq> | ReturnType<typeof sql<unknown>>> = [
    eq(libraryDoc.status, 'PUBLISHED'),
  ];
  if (whereExtra) conds.push(whereExtra);

  const orderArr = Array.isArray(orderBySql) ? orderBySql : [orderBySql];

  const rows = await db
    .select(docCardColumns)
    .from(libraryDoc)
    .leftJoin(userTable, eq(userTable.id, libraryDoc.uploaderId))
    .where(and(...conds))
    .orderBy(...orderArr, desc(libraryDoc.id))
    .limit(12);

  return rows.map(toDocCardData);
}

export async function HubCuratedSections({ hasActiveSearch }: { hasActiveSearch: boolean }) {
  if (hasActiveSearch) return null;

  const t = await getServerT();
  const session = await getServerSession();
  const userId = session?.user.id ?? null;

  let forYou: DocCardData[] = [];
  if (userId) {
    const [viewed, imported] = await Promise.all([
      db
        .select({ docId: libraryDocView.docId, subjectSlug: libraryDoc.subjectSlug })
        .from(libraryDocView)
        .innerJoin(libraryDoc, eq(libraryDoc.id, libraryDocView.docId))
        .where(eq(libraryDocView.userId, userId))
        .orderBy(desc(libraryDocView.viewedAt))
        .limit(40),
      db
        .select({ docId: libraryDocImport.docId, subjectSlug: libraryDoc.subjectSlug })
        .from(libraryDocImport)
        .innerJoin(libraryDoc, eq(libraryDoc.id, libraryDocImport.docId))
        .where(eq(libraryDocImport.importerId, userId))
        .limit(40),
    ]);

    const seenIds = new Set<string>();
    const subjCount = new Map<string, number>();
    for (const r of [...viewed, ...imported]) {
      seenIds.add(r.docId);
      subjCount.set(r.subjectSlug, (subjCount.get(r.subjectSlug) ?? 0) + 1);
    }
    const topSubjects = [...subjCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([s]) => s);

    if (topSubjects.length > 0) {
      const conds = [inArray(libraryDoc.subjectSlug, topSubjects)];
      if (seenIds.size > 0) conds.push(notInArray(libraryDoc.id, [...seenIds]));
      forYou = await fetchCurated([desc(libraryDoc.qualityScore)], and(...conds));
    }
  }

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
  } else {
    const popular = await fetchCurated([
      desc(
        sql`COALESCE(${libraryDoc.workspaceImportCount}, 0) * 2 + COALESCE(${libraryDoc.viewCount}, 0)`,
      ),
    ]);
    if (popular.length > 0) {
      sections.push({
        label: t('library.curated.trending'),
        icon: TrendingUp,
        iconClass: 'text-rose-500',
        docs: popular,
        href: '/library?sort=popular',
      });
    }
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
