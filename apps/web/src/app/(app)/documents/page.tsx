/**
 * /documents — list toàn bộ document cross-workspace.
 *
 * V8.16 (2026-05-20): trước đây redirect /workspaces (Phase 21 workspace-
 * centric). Giờ build lại proper list page để click "Xem tất cả" ở dashboard
 * có ý nghĩa thật, không bounce ngược.
 *
 * Layout:
 *   - Header: title + count
 *   - List rows: filename + workspace badge + relative time
 *   - Click row → /documents/[id] (page detail PDF + chunks đã có sẵn)
 *
 * Sort: lastest first (created_at desc). Limit 100 cho v1, chưa cần
 * pagination cursor.
 */
import { Suspense } from 'react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { ChevronRight, FileText } from 'lucide-react';

import { db, document, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { EmptyState } from '@/components/layout/empty-state';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { RelativeTime } from '@/components/ui/relative-time';
import { DocumentsUploadAction } from '@/components/documents/documents-upload-action';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function DocumentsListPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const rows = await db
    .select({
      id: document.id,
      filename: document.filename,
      status: document.status,
      createdAt: document.createdAt,
      workspaceId: document.workspaceId,
      workspaceName: workspace.name,
    })
    .from(document)
    .leftJoin(workspace, eq(workspace.id, document.workspaceId))
    .where(eq(document.userId, session.user.id))
    .orderBy(desc(document.createdAt))
    .limit(100);

  return (
    <PageShell>
      {/* Breadcrumb là điều hướng (CONTENT) — giữ NGAY TRƯỚC hero, không nhồi vào. */}
      <Breadcrumbs
        segments={[
          { href: '/workspaces', label: 'Workspaces' },
          { label: 'Tất cả tài liệu' },
        ]}
      />
      {/* Hero CHUNG thay header tự-chế — h1 → title, p → description, nút Upload → children. */}
      <PageHero
        eyebrow="Tài liệu"
        eyebrowIcon={FileText}
        title="Tất cả tài liệu"
        description={`${rows.length} tài liệu cross-workspace — mới nhất trên cùng.`}
      >
        {/* Nút Upload (+ auto-mở khi đáp `?upload=1` từ dashboard). Suspense vì
            DocumentsUploadAction đọc useSearchParams. */}
        <Suspense>
          <DocumentsUploadAction />
        </Suspense>
      </PageHero>

      {rows.length === 0 ? (
        <EmptyState
          title="Chưa có tài liệu nào"
          description="Bấm Upload ở góc trên để thêm PDF đầu tiên — Cogniva sẽ parse + index để bạn hỏi đáp có citation."
        />
      ) : (
        <ul className="overflow-hidden rounded-xl border bg-card/30 shadow-soft">
          {rows.map((d, i) => (
            <li
              key={d.id}
              className={i > 0 ? 'border-t' : undefined}
            >
              <Link
                href={`/documents/${d.id}`}
                className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.filename}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    {d.workspaceName && (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                        {d.workspaceName}
                      </span>
                    )}
                    <RelativeTime date={d.createdAt} />
                    {d.status !== 'READY' && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-600">
                        {d.status}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
