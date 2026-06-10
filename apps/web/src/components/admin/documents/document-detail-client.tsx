/**
 * DocumentDetailClient — chi tiết 1 document + chunks preview + actions.
 *
 * Actions:
 *   - Re-ingest (chỉ enable khi status FAILED hoặc READY) — SUPER_ADMIN/ADMIN
 *   - Delete (mọi status) — SUPER_ADMIN/ADMIN
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CircleCheck,
  FileText,
  MoreHorizontal,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import type { AdminRole } from '@cogniva/db';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { cn } from '@/lib/utils';

type DocStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

export type DocumentDetailData = {
  document: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    status: DocStatus;
    storageKey: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    userId: string | null;
    userName: string | null;
    userEmail: string | null;
    workspaceId: string | null;
    workspaceName: string | null;
  };
  chunks: { id: string; preview: string; tokens: number; metadata: Record<string, unknown> }[];
  stats: { chunkCount: number; tokenTotal: number };
};

export function DocumentDetailClient({
  data,
  adminRole,
}: {
  data: DocumentDetailData;
  adminRole: AdminRole;
}) {
  const router = useRouter();
  const { document: doc, chunks, stats } = data;

  const canMutate = adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN';

  const [reingestOpen, setReingestOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const doMutation = async (
    label: string,
    url: string,
    method: string,
    reason: string,
    onDoneRefresh: boolean,
  ) => {
    setLoading(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? `${label} thất bại`);
      }
      toast.success(`${label} thành công`);
      if (onDoneRefresh) {
        router.refresh();
      } else {
        router.push('/admin/documents');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} thất bại`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Header card */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-800/80 ring-1 ring-inset ring-slate-700">
              <FileText className="h-5 w-5 text-slate-300" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight">{doc.filename}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusPill status={doc.status} />
                <span className="font-mono text-[10.5px] text-slate-500">{doc.mimeType}</span>
                <span className="font-mono text-[10.5px] text-slate-500">
                  {formatSize(doc.size)}
                </span>
              </div>
              <p className="mt-1.5 font-mono text-[10.5px] text-slate-600">
                ID: {doc.id} · Uploaded {new Date(doc.createdAt).toLocaleString('vi-VN')}
              </p>
            </div>
          </div>

          {canMutate && (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800">
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 border-slate-800 bg-slate-900 text-slate-100">
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                  Hành động
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-slate-800" />
                <DropdownMenuItem
                  onClick={() => setReingestOpen(true)}
                  className="cursor-pointer focus:bg-slate-800"
                >
                  <RotateCw className="mr-2 h-3.5 w-3.5" />
                  Re-ingest
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-800" />
                <DropdownMenuItem
                  onClick={() => setDeleteOpen(true)}
                  className="cursor-pointer text-red-300 focus:bg-red-500/10 focus:text-red-200"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Xoá document
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Chunks" value={stats.chunkCount.toLocaleString('vi-VN')} />
          <StatTile label="Tokens" value={stats.tokenTotal.toLocaleString('vi-VN')} />
          <StatTile
            label="Owner"
            value={
              doc.userId ? (
                <Link href={`/admin/users/${doc.userId}`} className="hover:text-red-300">
                  {doc.userName ?? doc.userEmail ?? '—'}
                </Link>
              ) : (
                '—'
              )
            }
          />
          <StatTile label="Workspace" value={doc.workspaceName ?? '—'} />
        </div>
      </section>

      {/* Storage info */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Storage</h2>
        <dl className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
          <KV k="storage_key" v={doc.storageKey} mono />
          <KV
            k="metadata"
            v={
              Object.keys(doc.metadata ?? {}).length === 0
                ? '—'
                : JSON.stringify(doc.metadata)
            }
            mono
          />
        </dl>
      </section>

      {/* Chunks preview */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-tight">
            Chunks <span className="text-slate-500">(top 20 theo token count)</span>
          </h2>
          <span className="font-mono text-[10.5px] text-slate-500">
            {stats.chunkCount} total
          </span>
        </div>
        {chunks.length === 0 ? (
          <p className="text-xs text-slate-500">
            Chưa có chunk nào. Document có thể đang PROCESSING hoặc FAILED — chạy re-ingest.
          </p>
        ) : (
          <ul className="space-y-2">
            {chunks.map((c, i) => (
              <li
                key={c.id}
                className="rounded-md border border-slate-800/60 bg-slate-950/40 p-3"
              >
                <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] text-slate-500">
                  <span>
                    #{i + 1} · {c.id.slice(0, 8)}
                  </span>
                  <span>{c.tokens} tokens</span>
                </div>
                <p className="line-clamp-3 text-[12px] leading-snug text-slate-300">
                  {c.preview}…
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={reingestOpen}
        onOpenChange={setReingestOpen}
        title="Re-ingest document?"
        description={
          <span>
            Sẽ xoá toàn bộ <strong>{stats.chunkCount}</strong> chunks hiện tại và chạy lại
            pipeline parse + chunk + embed. File trên R2 không bị động đến.
          </span>
        }
        confirmLabel="Re-ingest"
        variant="warning"
        loading={loading}
        onConfirm={async (reason) => {
          await doMutation(
            'Re-ingest',
            `/api/admin/documents/${doc.id}/reingest`,
            'POST',
            reason,
            true,
          );
          setReingestOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xoá document khỏi DB?"
        description={
          <span>
            Document + tất cả chunks sẽ bị xoá (FK cascade). File trên R2 KHÔNG bị xoá —
            cleanup job riêng. Hành động không thể undo qua admin UI.
          </span>
        }
        confirmLabel="Xoá document"
        variant="destructive"
        loading={loading}
        onConfirm={async (reason) => {
          await doMutation(
            'Xoá document',
            `/api/admin/documents/${doc.id}`,
            'DELETE',
            reason,
            false,
          );
          setDeleteOpen(false);
        }}
      />
    </>
  );
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-slate-200">{value}</p>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-slate-800/60 bg-slate-950/40 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{k}</p>
      <p className={cn('mt-0.5 truncate text-[12px] text-slate-300', mono && 'font-mono text-[11px]')}>
        {v}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: DocStatus }) {
  const cfg = {
    READY: { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', icon: CircleCheck },
    PROCESSING: { cls: 'border-blue-500/30 bg-blue-500/10 text-blue-300', icon: RotateCw },
    UPLOADING: { cls: 'border-slate-500/30 bg-slate-500/10 text-slate-300', icon: RotateCw },
    FAILED: { cls: 'border-red-500/30 bg-red-500/10 text-red-300', icon: AlertCircle },
  }[status];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
        cfg.cls,
      )}
    >
      <Icon
        className={cn('h-2.5 w-2.5', status === 'PROCESSING' || status === 'UPLOADING' ? 'animate-spin' : '')}
      />
      {status}
    </span>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
