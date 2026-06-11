'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Ban,
  BookOpen,
  CheckCircle2,
  Download,
  FileVideo,
  Globe2,
  Loader2,
  MoreHorizontal,
  Mic,
  ShieldCheck,
  Trash2,
  Users as UsersIcon,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';

import type { AdminRole } from '@cogniva/db';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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

type Role = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';

type Member = {
  id: string;
  userId: string;
  role: Role;
  nickname: string | null;
  joinedAt: string;
  mutedUntil: string | null;
  userName: string | null;
  userEmail: string | null;
  userImage: string | null;
};

export type GroupDetailData = {
  group: {
    id: string;
    name: string;
    description: string | null;
    iconUrl: string | null;
    bannerUrl: string | null;
    isPublic: boolean;
    maxMembers: number;
    inviteCode: string;
    suspendedAt: string | null;
    suspendReason: string | null;
    createdAt: string;
    ownerId: string | null;
    ownerName: string | null;
    ownerEmail: string | null;
  };
  members: Member[];
  stats: { memberCount: number; channelCount: number; messageCount: number };
};

export function GroupDetailClient({
  data,
  adminRole,
}: {
  data: GroupDetailData;
  adminRole: AdminRole;
}) {
  const router = useRouter();
  const { group: g, members, stats } = data;
  const canMutate = adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN';
  const canDelete = adminRole === 'SUPER_ADMIN';

  const [suspendOpen, setSuspendOpen] = React.useState(false);
  const [unsuspendOpen, setUnsuspendOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const doAction = async (
    label: string,
    url: string,
    reason: string,
    onSuccess: 'refresh' | 'back' = 'refresh',
  ) => {
    setLoading(true);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? `${label} thất bại`);
      }
      toast.success(`${label} thành công`);
      if (onSuccess === 'back') router.push('/admin/groups');
      else router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} thất bại`);
    } finally {
      setLoading(false);
    }
  };

  const initial = (g.name?.[0] ?? '?').toUpperCase();

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        {g.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={g.bannerUrl} alt="" className="h-32 w-full object-cover" />
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <Avatar className="h-12 w-12 shrink-0 rounded-lg">
                <AvatarImage src={g.iconUrl ?? undefined} className="rounded-lg" />
                <AvatarFallback className="rounded-lg bg-slate-800 text-[14px] text-slate-300">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-tight">{g.name}</h1>
                {g.description && (
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-slate-400">{g.description}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {g.suspendedAt ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-red-400 ring-1 ring-inset ring-red-500/30">
                      <Ban className="h-2.5 w-2.5" />
                      SUSPENDED
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      active
                    </span>
                  )}
                  {g.isPublic && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-300">
                      <Globe2 className="h-2.5 w-2.5" />
                      public
                    </span>
                  )}
                  <span className="font-mono text-[10.5px] text-slate-500">
                    invite: {g.inviteCode}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10.5px] text-slate-600">
                  ID: {g.id} · created {new Date(g.createdAt).toLocaleString('vi-VN')}
                </p>
              </div>
            </div>

            {canMutate && (
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
                  {g.suspendedAt ? (
                    <DropdownMenuItem
                      onClick={() => setUnsuspendOpen(true)}
                      className="cursor-pointer text-emerald-300 focus:bg-emerald-500/10 focus:text-emerald-200"
                    >
                      <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                      Unsuspend
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => setSuspendOpen(true)}
                      className="cursor-pointer text-red-300 focus:bg-red-500/10 focus:text-red-200"
                    >
                      <Ban className="mr-2 h-3.5 w-3.5" />
                      Suspend group
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      onClick={() => setDeleteOpen(true)}
                      className="cursor-pointer text-red-300 focus:bg-red-500/10 focus:text-red-200"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Hard delete group
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {g.suspendedAt && g.suspendReason && (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2.5 text-[12px] text-red-200">
              <span className="font-semibold">Lý do suspend:</span> {g.suspendReason}
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Members" value={`${stats.memberCount}/${g.maxMembers}`} />
            <StatTile label="Channels" value={stats.channelCount.toLocaleString('vi-VN')} />
            <StatTile label="Messages" value={stats.messageCount.toLocaleString('vi-VN')} />
            <StatTile
              label="Owner"
              value={
                g.ownerId ? (
                  <Link href={`/admin/users/${g.ownerId}`} className="hover:text-red-300">
                    {g.ownerName ?? g.ownerEmail ?? '—'}
                  </Link>
                ) : (
                  '—'
                )
              }
            />
          </div>
        </div>
      </section>

      <GroupTabs groupId={g.id} members={members} stats={stats} canMutate={canMutate} />

      <ConfirmDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title={`Suspend group "${g.name}"?`}
        description={
          <span>
            Group sẽ bị ẩn khỏi public explore. Member sẽ không gửi được message mới (Phase 2
            enforcement). Có thể unsuspend bất kỳ lúc nào.
          </span>
        }
        confirmLabel="Suspend group"
        variant="destructive"
        loading={loading}
        onConfirm={async (reason) => {
          await doAction('Suspend group', `/api/admin/groups/${g.id}/suspend`, reason);
          setSuspendOpen(false);
        }}
      />
      <ConfirmDialog
        open={unsuspendOpen}
        onOpenChange={setUnsuspendOpen}
        title={`Khôi phục group "${g.name}"?`}
        description={
          <span>
            Group sẽ hoạt động bình thường trở lại. Member có thể chat. Mọi data của group được giữ
            nguyên.
          </span>
        }
        confirmLabel="Unsuspend"
        variant="default"
        loading={loading}
        onConfirm={async (reason) => {
          await doAction('Unsuspend', `/api/admin/groups/${g.id}/unsuspend`, reason);
          setUnsuspendOpen(false);
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Xoá vĩnh viễn group "${g.name}"?`}
        description={
          <span>
            Hard delete — toàn bộ <strong>{stats.channelCount} channels</strong>,{' '}
            <strong>{stats.messageCount} messages</strong>,{' '}
            <strong>{stats.memberCount} members</strong>, voice recordings sẽ bị xoá (FK CASCADE).
            KHÔNG khôi phục được. Chỉ SUPER_ADMIN dùng được.
          </span>
        }
        confirmLabel="Xoá vĩnh viễn"
        variant="destructive"
        loading={loading}
        onConfirm={async (reason) => {
          await doAction('Xoá group', `/api/admin/groups/${g.id}/delete`, reason, 'back');
          setDeleteOpen(false);
        }}
      />
    </>
  );
}

function MemberRow({ m }: { m: Member }) {
  const initial = (m.userName?.[0] ?? m.userEmail?.[0] ?? '?').toUpperCase();
  const isMuted = m.mutedUntil && new Date(m.mutedUntil) > new Date();
  return (
    <tr className="border-b border-slate-800/40 transition-colors hover:bg-slate-800/40">
      <td className="px-5 py-2">
        <Link
          href={`/admin/users/${m.userId}`}
          className="flex items-center gap-2.5 text-slate-100 hover:text-red-300"
        >
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarImage src={m.userImage ?? undefined} />
            <AvatarFallback className="bg-slate-800 text-[10.5px] text-slate-300">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight">
              {m.nickname || m.userName || '—'}
            </p>
            <p className="truncate font-mono text-[10.5px] text-slate-500">{m.userEmail ?? '—'}</p>
          </div>
        </Link>
      </td>
      <td className="px-3 py-2">
        <RolePill role={m.role} />
      </td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-500">
        {new Date(m.joinedAt).toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
        })}
      </td>
      <td className="px-3 py-2">
        {isMuted ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-300"
            title={`muted until ${m.mutedUntil}`}
          >
            <VolumeX className="h-2.5 w-2.5" />
            muted
          </span>
        ) : (
          <span className="text-[10.5px] text-slate-600">—</span>
        )}
      </td>
    </tr>
  );
}

function RolePill({ role }: { role: Role }) {
  const cfg = {
    OWNER: { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300', Icon: BookOpen },
    ADMIN: { cls: 'border-red-500/30 bg-red-500/10 text-red-300', Icon: ShieldCheck },
    MODERATOR: { cls: 'border-blue-500/30 bg-blue-500/10 text-blue-300', Icon: ShieldCheck },
    MEMBER: { cls: 'border-slate-600/30 bg-slate-700/20 text-slate-400', Icon: ShieldCheck },
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

type Recording = {
  id: string;
  channelId: string | null;
  channelName: string | null;
  createdBy: string | null;
  recorderName: string | null;
  recorderEmail: string | null;
  storageKey: string | null;
  fileUrl: string | null;
  duration: number | null;
  fileSize: number | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
};

function GroupTabs({
  groupId,
  members,
  stats,
  canMutate,
}: {
  groupId: string;
  members: Member[];
  stats: { memberCount: number; channelCount: number; messageCount: number };
  canMutate: boolean;
}) {
  const [tab, setTab] = React.useState<'members' | 'recordings'>('members');
  const [recordings, setRecordings] = React.useState<Recording[] | null>(null);
  const [recLoading, setRecLoading] = React.useState(false);

  const loadRecordings = React.useCallback(async () => {
    setRecLoading(true);
    try {
      const res = await fetch(`/api/admin/groups/${groupId}/recordings`);
      const d = (await res.json()) as { recordings: Recording[] };
      setRecordings(d.recordings);
    } catch {
      toast.error('Lỗi tải recordings');
    } finally {
      setRecLoading(false);
    }
  }, [groupId]);

  React.useEffect(() => {
    if (tab === 'recordings' && recordings === null) {
      loadRecordings();
    }
  }, [tab, recordings, loadRecordings]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/30">
      <div className="flex items-center gap-1 border-b border-slate-800 px-3 pt-2">
        <TabBtn
          active={tab === 'members'}
          onClick={() => setTab('members')}
          icon={UsersIcon}
          label={`Members (${stats.memberCount})`}
        />
        <TabBtn
          active={tab === 'recordings'}
          onClick={() => setTab('recordings')}
          icon={Mic}
          label="Voice recordings"
        />
      </div>

      {tab === 'members' ? (
        <table className="w-full text-[13px]">
          <thead className="bg-slate-900/60">
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-5 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Joined</th>
              <th className="px-3 py-2">Mute</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow key={m.id} m={m} />
            ))}
          </tbody>
        </table>
      ) : (
        <RecordingsList
          recordings={recordings}
          loading={recLoading}
          canMutate={canMutate}
          onDeleted={loadRecordings}
        />
      )}
    </section>
  );
}

function RecordingsList({
  recordings,
  loading,
  canMutate,
  onDeleted,
}: {
  recordings: Recording[] | null;
  loading: boolean;
  canMutate: boolean;
  onDeleted: () => void;
}) {
  const [active, setActive] = React.useState<Recording | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);

  const doDelete = async (reason: string) => {
    if (!active) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/recordings/${active.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? 'Xoá thất bại');
      }
      toast.success('Đã xoá recording');
      setActive(null);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Xoá thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || recordings === null) {
    return (
      <div className="py-12 text-center text-slate-500">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (recordings.length === 0) {
    return (
      <p className="px-5 py-12 text-center text-xs text-slate-500">
        Group này chưa có voice recording nào.
      </p>
    );
  }
  return (
    <>
      <table className="w-full text-[13px]">
        <thead className="bg-slate-900/60">
          <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <th className="px-5 py-2">Recording</th>
            <th className="px-3 py-2">Recorder</th>
            <th className="px-3 py-2">Duration</th>
            <th className="px-3 py-2">Size</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Started</th>
            <th className="px-3 py-2 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((r) => (
            <tr
              key={r.id}
              className="border-b border-slate-800/40 transition-colors hover:bg-slate-800/40"
            >
              <td className="px-5 py-2">
                <div className="flex items-center gap-2">
                  <FileVideo className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium leading-tight">
                      {r.channelName ?? '—'}
                    </p>
                    <p className="truncate font-mono text-[10.5px] text-slate-500">
                      {r.id.slice(0, 12)}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 text-[12px] text-slate-400">
                {r.recorderName ?? r.recorderEmail ?? '—'}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-300">
                {formatDuration(r.duration)}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-400">
                {formatBytes(r.fileSize)}
              </td>
              <td className="px-3 py-2">
                <RecordingStatusPill status={r.status} />
              </td>
              <td className="px-3 py-2 font-mono text-[10.5px] tabular-nums text-slate-500">
                {new Date(r.startedAt).toLocaleString('vi-VN', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  {r.fileUrl && (
                    <a
                      href={r.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
                      aria-label="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {canMutate && (
                    <button
                      onClick={() => setActive(r)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                      aria-label="Xoá"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmDialog
        open={!!active}
        onOpenChange={(o) => !o && setActive(null)}
        title="Xoá recording?"
        description={
          <span>
            Xoá DB row recording. File trên R2 sẽ được cleanup job nightly dọn (orphan storageKey).
            Audit log lưu storageKey để forensic recovery.
          </span>
        }
        confirmLabel="Xoá recording"
        variant="destructive"
        loading={actionLoading}
        onConfirm={doDelete}
      />
    </>
  );
}

function RecordingStatusPill({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    PROCESSED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    PROCESSING: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    RECORDING: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    FAILED: 'border-red-500/30 bg-red-500/10 text-red-300',
  };
  const cls = cfg[status] ?? 'border-slate-600/30 bg-slate-700/10 text-slate-400';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
        cls,
      )}
    >
      {status}
    </span>
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
  icon: typeof UsersIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12px] font-medium transition-colors',
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

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
