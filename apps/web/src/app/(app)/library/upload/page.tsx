import { apiServerOrNull } from '@/lib/api-server';
import { PageShell } from '@/components/layout/page-shell';
import { UploadWizard } from '@/components/library/upload-wizard';

export const dynamic = 'force-dynamic';

export default async function LibraryUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const sp = await searchParams;

  let initialCourse: { id: string; label: string } | null = null;
  if (sp.course) {
    const c = await apiServerOrNull<{ id: string; name: string; code: string | null }>(
      `/api/library/courses/${sp.course}`,
    );
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
