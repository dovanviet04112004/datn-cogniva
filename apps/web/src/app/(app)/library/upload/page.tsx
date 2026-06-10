/**
 * /library/upload — Upload wizard V1.
 *
 * Server component shell + client wizard form. Hỗ trợ prefill course qua
 * `?course=<id>` (từ CTA "Đóng góp tài liệu" trên course landing page).
 */
import { eq } from 'drizzle-orm';

import { db, libraryCourse } from '@cogniva/db';

import { PageShell } from '@/components/layout/page-shell';
import { UploadWizard } from '@/components/library/upload-wizard';

export const dynamic = 'force-dynamic';

export default async function LibraryUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const sp = await searchParams;

  // Prefill course nếu đến từ course landing page
  let initialCourse: { id: string; label: string } | null = null;
  if (sp.course) {
    const [c] = await db
      .select({ id: libraryCourse.id, name: libraryCourse.name, code: libraryCourse.code })
      .from(libraryCourse)
      .where(eq(libraryCourse.id, sp.course))
      .limit(1);
    if (c) {
      initialCourse = { id: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name };
    }
  }

  return (
    <PageShell
      title="Tải tài liệu lên kho"
      description="Chia sẻ tài liệu học tập với cộng đồng Cogniva. AI sẽ tự embed + AI summary."
      size="default"
    >
      <UploadWizard initialCourse={initialCourse} />
    </PageShell>
  );
}
