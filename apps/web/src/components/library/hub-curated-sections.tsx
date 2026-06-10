/**
 * HubCuratedSections — Phase 4 (2026-05-27, refactor 2026-05-28).
 *
 * Server component render carousel trên library hub. Carousel CHỈ dành cho
 * curation thật mà sort không cho được (giống home trang lớn):
 *   - ✨ Dành cho bạn — cá nhân hoá theo môn của lịch sử view/import, loại doc
 *     đã xem; chỉ hiện khi user có signal. (Không See-all — feed cá nhân.)
 *   - Cold-start (chưa có signal / chưa đăng nhập) → fallback 📈 Phổ biến để
 *     feed không rỗng; See-all → ?sort=popular.
 *
 * Render qua DocCarousel dùng đúng DocCard → card GIỐNG HỆT grid + cuộn ngang.
 * Ẩn khi user đang search (có active filter) — focus search UX không bị nhiễu.
 */
import Link from 'next/link';
import { headers } from 'next/headers';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { Sparkles, TrendingUp } from 'lucide-react';

import {
  db,
  libraryDoc,
  libraryDocImport,
  libraryDocView,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { getServerT } from '@/lib/i18n/server';
import { docCardColumns, toDocCardData } from '@/lib/library/doc-card-data';
// SectionHeading dùng chung toàn app — thay khối tiêu đề mục gradient cũ.
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

  // Tie-break theo id ở cuối: các cột sort (qualityScore/importCount/viewCount)
  // nhiều giá trị trùng (0) → thiếu tie-break sẽ trả order không xác định, gây
  // hydration mismatch giữa SSR HTML và RSC flight.
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

export async function HubCuratedSections({
  hasActiveSearch,
}: {
  hasActiveSearch: boolean;
}) {
  if (hasActiveSearch) return null; // ẩn khi user đang search

  const t = await getServerT();
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;

  // "Dành cho bạn" — content-based: gom môn từ lịch sử view + import của user,
  // gợi ý doc chất lượng cao cùng môn mà user CHƯA xem. Chỉ khi có signal.
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

  // Section: "Dành cho bạn" (cá nhân hoá) hoặc cold-start fallback "Phổ biến".
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
    // Cold-start fallback: Phổ biến (import×2 + view). See-all → ?sort=popular.
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
            {/* Tiêu đề mục curated + count + link "Xem tất cả" (slot action). */}
            <SectionHeading
              count={sec.docs.length}
              action={
                sec.href ? (
                  <Link
                    href={sec.href}
                    className="text-[11px] font-medium text-muted-foreground hover:text-primary"
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
