/**
 * ConversationDetailClient — full thread read-only + soft-delete action.
 *
 * Render messages giống chat UI thường nhưng có metadata badge (tokens, cost,
 * latency) phía dưới mỗi message. Citations render link tới chunk preview ở
 * tooltip — Phase 2 chỉ show ID.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bot, MoreHorizontal, ShieldAlert, Trash2, User as UserIcon } from 'lucide-react';
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

type Role = 'USER' | 'ASSISTANT' | 'SYSTEM';

type Citation = { chunkId?: string; documentId?: string; [k: string]: unknown };

type MsgMetadata = {
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs?: number;
  provider?: string;
  model?: string;
  [k: string]: unknown;
};

type Message = {
  id: string;
  role: Role;
  content: string;
  citations: Citation[];
  metadata: MsgMetadata;
  createdAt: string;
};

export type ConversationDetailData = {
  conversation: {
    id: string;
    title: string | null;
    createdAt: string;
    userId: string | null;
    userName: string | null;
    userEmail: string | null;
    workspaceId: string | null;
    workspaceName: string | null;
  };
  messages: Message[];
};

export function ConversationDetailClient({
  data,
  adminRole,
}: {
  data: ConversationDetailData;
  adminRole: AdminRole;
}) {
  const router = useRouter();
  const { conversation: conv, messages } = data;

  const canDelete = adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN';
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const doDelete = async (reason: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/conversations/${conv.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? 'Xoá thất bại');
      }
      toast.success('Đã xoá conversation');
      router.push('/admin/conversations');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Xoá thất bại');
    } finally {
      setLoading(false);
      setDeleteOpen(false);
    }
  };

  return (
    <>
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {conv.title?.trim() || (
                <span className="italic text-slate-500">— không có tiêu đề —</span>
              )}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
              {conv.userId ? (
                <Link
                  href={`/admin/users/${conv.userId}`}
                  className="font-mono text-[11px] text-slate-300 hover:text-red-300"
                >
                  {conv.userEmail ?? conv.userName ?? '—'}
                </Link>
              ) : (
                <span className="font-mono text-[11px]">—</span>
              )}
              {conv.workspaceName && (
                <>
                  <span className="text-slate-700">·</span>
                  <span className="text-[11px]">workspace: {conv.workspaceName}</span>
                </>
              )}
              <span className="text-slate-700">·</span>
              <span className="font-mono text-[10.5px] text-slate-500">
                {messages.length} messages · started{' '}
                {new Date(conv.createdAt).toLocaleString('vi-VN')}
              </span>
            </div>
          </div>
          {canDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800">
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-52 border-slate-800 bg-slate-900 text-slate-100"
              >
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                  Hành động
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-slate-800" />
                <DropdownMenuItem
                  onClick={() => setDeleteOpen(true)}
                  className="cursor-pointer text-red-300 focus:bg-red-500/10 focus:text-red-200"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Xoá conversation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </section>

      <section className="space-y-3">
        {messages.length === 0 ? (
          <p className="rounded-md border border-slate-800/60 bg-slate-900/30 p-6 text-center text-xs text-slate-500">
            Conversation chưa có message nào.
          </p>
        ) : (
          messages.map((m) => <MessageItem key={m.id} m={m} />)
        )}
      </section>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xoá conversation?"
        description={
          <span>
            Toàn bộ <strong>{messages.length}</strong> messages sẽ bị xoá vĩnh viễn (FK
            cascade). Chỉ dùng cho support case nhạy cảm (vd: user yêu cầu GDPR).
          </span>
        }
        confirmLabel="Xoá conversation"
        variant="destructive"
        loading={loading}
        onConfirm={doDelete}
      />
    </>
  );
}

function MessageItem({ m }: { m: Message }) {
  const isUser = m.role === 'USER';
  const isSystem = m.role === 'SYSTEM';
  return (
    <article
      className={cn(
        'rounded-lg border bg-slate-900/30 p-4',
        isSystem
          ? 'border-amber-500/30 bg-amber-500/5'
          : 'border-slate-800/60',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RoleBadge role={m.role} />
          {m.metadata?.provider && (
            <span className="font-mono text-[10px] text-slate-500">
              {m.metadata.provider}
              {m.metadata.model ? ` · ${m.metadata.model}` : ''}
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] tabular-nums text-slate-500">
          {new Date(m.createdAt).toLocaleString('vi-VN')}
        </span>
      </div>

      <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-slate-200">
        {m.content}
      </pre>

      {/* Citations */}
      {m.citations && m.citations.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[11px] uppercase tracking-wider text-slate-500">
            Citations:
          </span>
          {m.citations.map((c, i) => (
            <span
              key={i}
              className="rounded bg-slate-800/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
              title={JSON.stringify(c)}
            >
              {c.chunkId ? `chunk:${String(c.chunkId).slice(0, 6)}` : `cite#${i + 1}`}
            </span>
          ))}
        </div>
      )}

      {/* Metadata bar */}
      {(m.metadata?.tokensIn ||
        m.metadata?.tokensOut ||
        m.metadata?.costUsd ||
        m.metadata?.latencyMs) && (
        <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-800/60 pt-2 font-mono text-[10px] tabular-nums text-slate-500">
          {m.metadata.tokensIn !== undefined && <span>in: {m.metadata.tokensIn}</span>}
          {m.metadata.tokensOut !== undefined && <span>out: {m.metadata.tokensOut}</span>}
          {m.metadata.costUsd !== undefined && (
            <span>cost: ${m.metadata.costUsd.toFixed(5)}</span>
          )}
          {m.metadata.latencyMs !== undefined && <span>{m.metadata.latencyMs}ms</span>}
        </div>
      )}
    </article>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const cfg = {
    USER: { cls: 'border-slate-700 bg-slate-800/60 text-slate-300', Icon: UserIcon },
    ASSISTANT: {
      cls: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
      Icon: Bot,
    },
    SYSTEM: {
      cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      Icon: ShieldAlert,
    },
  }[role];
  const Icon = cfg.Icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
        cfg.cls,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {role}
    </span>
  );
}
