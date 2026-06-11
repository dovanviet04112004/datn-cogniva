import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { ChevronRight, FileText } from 'lucide-react';

import { db, document, workspace } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { EmptyState } from '@/components/layout/empty-state';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { RelativeTime } from '@/components/ui/relative-time';
import { DocumentsUploadAction } from '@/components/documents/documents-upload-action';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function DocumentsListPage() {
  const session = await getServerSession();
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
      <Breadcrumbs
        segments={[{ href: '/workspaces', label: 'Workspaces' }, { label: 'Tất cả tài liệu' }]}
      />
      <PageHero
        eyebrow="Tài liệu"
        eyebrowIcon={FileText}
        title="Tất cả tài liệu"
        description={`${rows.length} tài liệu cross-workspace — mới nhất trên cùng.`}
      >
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
        <ul className="bg-card/30 shadow-soft overflow-hidden rounded-xl border">
          {rows.map((d, i) => (
            <li key={d.id} className={i > 0 ? 'border-t' : undefined}>
              <Link
                href={`/documents/${d.id}`}
                className="hover:bg-muted/50 group flex items-center gap-4 px-4 py-3 transition-colors"
              >
                <div className="bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.filename}</p>
                  <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-[11px]">
                    {d.workspaceName && (
                      <span className="bg-muted rounded px-1.5 py-0.5 font-medium">
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
                <ChevronRight className="text-muted-foreground/60 group-hover:text-foreground h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
