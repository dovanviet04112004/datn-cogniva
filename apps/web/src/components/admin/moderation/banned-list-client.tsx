'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  CheckCircle2,
  Loader2,
  Search,
  ShieldCheck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import type { AdminRole } from '@cogniva/db';
import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { cn } from '@/lib/utils';

type BannedUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  suspendedAt: string | null;
  suspendReason: string | null;
  adminRole: AdminRole | null;
};

type BannedGroup = {
  id: string;
  name: string;
  iconUrl: string | null;
  suspendedAt: string | null;
  suspendReason: string | null;
  ownerUserId: string;
};

export function BannedListClient({ adminRole }: { adminRole: AdminRole }) {
  const router = useRouter();
  const canMutate = adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN';

  const [tab, setTab] = React.useState<'users' | 'groups'>('users');
  const [q, setQ] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');

  const [active, setActive] = React.useState<{
    type: 'user' | 'group';
    id: string;
    name: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const {
    data,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: qk.adminBanned(debouncedQ),
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedQ) params.set('q', debouncedQ);
      return apiGet<{ users: BannedUser[]; groups: BannedGroup[] }>(
        `/api/admin/moderation/banned?${params}`,
      );
    },
  });
  const users = data?.users ?? [];
  const groups = data?.groups ?? [];

  const doUnsuspend = async (reason: string) => {
    if (!active) return;
    setActionLoading(true);
    const url =
      active.type === 'user'
        ? `/api/admin/users/${active.id}/unsuspend`
        : `/api/admin/groups/${active.id}/unsuspend`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? 'Unsuspend thất bại');
      }
      toast.success(`Đã khôi phục ${active.type === 'user' ? 'user' : 'group'} "${active.name}"`);
      setActive(null);
      void refetch();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unsuspend thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Banned</h1>
        <p className="text-sm text-slate-400">
          Users + groups đang bị suspend. Click &quot;Unsuspend&quot; để khôi phục — yêu cầu lý do.
        </p>
      </header>

      <div className="flex items-center gap-1 border-b border-slate-800">
        <TabBtn
          active={tab === 'users'}
          onClick={() => setTab('users')}
          icon={UserIcon}
          label={`Users (${users.length})`}
        />
        <TabBtn
          active={tab === 'groups'}
          onClick={() => setTab('groups')}
          icon={BookOpen}
          label={`Groups (${groups.length})`}
        />
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tab === 'users' ? 'Tên hoặc email…' : 'Tên group…'}
          className="h-9 w-full rounded-md border border-slate-800 bg-slate-900 pl-8 pr-7 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
        />
        {q && (
          <button
            onClick={() => setQ('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-500">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : tab === 'users' ? (
        <UsersTable
          users={users}
          canMutate={canMutate}
          onUnsuspend={(u) => setActive({ type: 'user', id: u.id, name: u.name ?? u.email })}
        />
      ) : (
        <GroupsTable
          groups={groups}
          canMutate={canMutate}
          onUnsuspend={(g) => setActive({ type: 'group', id: g.id, name: g.name })}
        />
      )}

      <ConfirmDialog
        open={!!active}
        onOpenChange={(o) => !o && setActive(null)}
        title={
          active ? `Khôi phục ${active.type === 'user' ? 'user' : 'group'} "${active.name}"?` : ''
        }
        description={
          active?.type === 'user' ? (
            <span>
              User sẽ có thể sign-in lại bình thường. Mọi data của họ được giữ nguyên. Audit log sẽ
              ghi action này kèm lý do.
            </span>
          ) : (
            <span>
              Group sẽ hoạt động lại bình thường. Member có thể chat. Mọi data của group được giữ
              nguyên.
            </span>
          )
        }
        confirmLabel="Khôi phục"
        variant="default"
        loading={actionLoading}
        onConfirm={doUnsuspend}
      />
    </div>
  );
}

function UsersTable({
  users,
  canMutate,
  onUnsuspend,
}: {
  users: BannedUser[];
  canMutate: boolean;
  onUnsuspend: (u: BannedUser) => void;
}) {
  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 py-12 text-center text-xs text-slate-500">
        Không có user nào đang bị suspend.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
      <table className="w-full text-[13px]">
        <thead className="bg-slate-900/60">
          <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <th className="px-3 py-2.5">User</th>
            <th className="px-3 py-2.5">Lý do</th>
            <th className="px-3 py-2.5">Suspended</th>
            <th className="px-3 py-2.5 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const initial = (u.name?.[0] ?? u.email[0] ?? '?').toUpperCase();
            return (
              <tr
                key={u.id}
                className="border-b border-slate-800/40 transition-colors hover:bg-slate-800/40"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="flex items-center gap-2.5 text-slate-100"
                  >
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarImage src={u.image ?? undefined} />
                      <AvatarFallback className="bg-slate-800 text-[10.5px] text-slate-300">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-[13px] font-medium leading-tight">
                        {u.name ?? '—'}
                        {u.adminRole && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-px font-mono text-[10px] font-bold text-amber-300">
                            <ShieldCheck className="h-2 w-2" />
                            {u.adminRole}
                          </span>
                        )}
                      </p>
                      <p className="truncate font-mono text-[10.5px] text-slate-500">{u.email}</p>
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-2 text-[12px] text-slate-400">
                  {u.suspendReason ?? <span className="italic text-slate-600">—</span>}
                </td>
                <td className="px-3 py-2 font-mono text-[10.5px] tabular-nums text-slate-500">
                  {u.suspendedAt
                    ? new Date(u.suspendedAt).toLocaleDateString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                      })
                    : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {canMutate && (
                    <button
                      onClick={() => onUnsuspend(u)}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Unsuspend
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupsTable({
  groups,
  canMutate,
  onUnsuspend,
}: {
  groups: BannedGroup[];
  canMutate: boolean;
  onUnsuspend: (g: BannedGroup) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 py-12 text-center text-xs text-slate-500">
        Không có group nào đang bị suspend.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
      <table className="w-full text-[13px]">
        <thead className="bg-slate-900/60">
          <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <th className="px-3 py-2.5">Group</th>
            <th className="px-3 py-2.5">Lý do</th>
            <th className="px-3 py-2.5">Suspended</th>
            <th className="px-3 py-2.5 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const initial = (g.name?.[0] ?? '?').toUpperCase();
            return (
              <tr
                key={g.id}
                className="border-b border-slate-800/40 transition-colors hover:bg-slate-800/40"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/groups/${g.id}`}
                    className="flex items-center gap-2.5 text-slate-100"
                  >
                    <Avatar className="h-7 w-7 shrink-0 rounded-md">
                      <AvatarImage src={g.iconUrl ?? undefined} className="rounded-md" />
                      <AvatarFallback className="rounded-md bg-slate-800 text-[10.5px] text-slate-300">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium leading-tight">{g.name}</p>
                      <p className="truncate font-mono text-[10.5px] text-slate-500">
                        {g.id.slice(0, 12)}
                      </p>
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-2 text-[12px] text-slate-400">
                  {g.suspendReason ?? <span className="italic text-slate-600">—</span>}
                </td>
                <td className="px-3 py-2 font-mono text-[10.5px] tabular-nums text-slate-500">
                  {g.suspendedAt
                    ? new Date(g.suspendedAt).toLocaleDateString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                      })
                    : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {canMutate && (
                    <button
                      onClick={() => onUnsuspend(g)}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Unsuspend
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof UserIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
        active
          ? 'border-red-500 text-slate-100'
          : 'border-transparent text-slate-400 hover:text-slate-200',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
