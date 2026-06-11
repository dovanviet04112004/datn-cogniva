/**
 * RecentlyViewed — "Đọc tiếp" strip cho library hub.
 *
 * Server component fetch docs user đã view gần nhất. Render qua DocCarousel
 * dùng đúng DocCard (giống hệt card ở grid) + cuộn ngang có nút mũi tên.
 */
import { desc, eq } from 'drizzle-orm';
import { Clock } from 'lucide-react';

import { db, libraryDoc, libraryDocView, user as userTable } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { getServerT } from '@/lib/i18n/server';
import { docCardColumns, toDocCardData } from '@/lib/library/doc-card-data';
// SectionHeading dùng chung toàn app — thay khối tiêu đề mục eyebrow cũ.
import { SectionHeading } from '@/components/ui/section-heading';

import { DocCarousel } from './doc-carousel';

export async function RecentlyViewed() {
  const session = await getServerSession();
  if (!session?.user.id) return null;

  const rows = await db
    .select(docCardColumns)
    .from(libraryDocView)
    .innerJoin(libraryDoc, eq(libraryDoc.id, libraryDocView.docId))
    .leftJoin(userTable, eq(userTable.id, libraryDoc.uploaderId))
    .where(eq(libraryDocView.userId, session.user.id))
    // Tie-break theo id: nhiều view cùng viewedAt sẽ trả CỐ ĐỊNH 1 thứ tự, tránh
    // hydration mismatch khi SSR HTML và RSC flight render lệch order.
    .orderBy(desc(libraryDocView.viewedAt), desc(libraryDocView.id))
    .limit(12);

  if (rows.length === 0) return null;

  const t = await getServerT();
  const docs = rows.map(toDocCardData);

  return (
    <section className="mb-5">
      {/* Tiêu đề mục "Đọc tiếp" + count — dùng SectionHeading chung. */}
      <SectionHeading count={docs.length}>
        <span className="inline-flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-discovery-500" />
          {t('library.recent.title')}
        </span>
      </SectionHeading>
      <DocCarousel docs={docs} />
    </section>
  );
}
