'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Calendar,
  Crown,
  FileText,
  Flame,
  LogOut,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  UserX,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT';
type Plan = 'FREE' | 'PRO' | 'TEAM';

type UserDetailData = {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    plan: Plan;
    isPublic: boolean;
    adminRole: AdminRole | null;
    suspendedAt: string | null;
    suspendReason: string | null;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
  };
  stats: {
    docs: number;
    conversations: number;
    flashcards: number;
    groups: number;
    xp: number;
    currentStreak: number;
    longestStreak: number;
    lastActivityDate: string | null;
  };
  recentAudit: Array<{
    id: string;
    action: string;
    adminId: string;
    payload: { reason?: string | null } | unknown;
    createdAt: string;
  }>;
};

type Props = {
  data: UserDetailData;
  currentAdminId: string;
  adminRole: AdminRole;
};

type Action = null | 'suspend' | 'unsuspend' | 'change-plan' | 'force-signout' | 'impersonate';

export function UserDetailClient({ data, currentAdminId, adminRole }: Props) {
  const router = useRouter();
  const u = data.user;
  const isSelf = u.id === currentAdminId;
  const canMutate = !isSelf && (adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN');

  const [action, setAction] = React.useState<Action>(null);
  const [pendingPlan, setPendingPlan] = React.useState<Plan>('FREE');
  const [loading, setLoading] = React.useState(false);

  const runSuspend = async (reason: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? `Status ${res.status}`);
      toast.success('Đã suspend user. Session đã bị xoá.');
      setAction(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const runUnsuspend = async (reason: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/unsuspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? `Status ${res.status}`);
      toast.success('Đã restore user.');
      setAction(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const runChangePlan = async (reason: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: pendingPlan, reason }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? `Status ${res.status}`);
      toast.success(`Đã đổi plan sang ${pendingPlan}.`);
      setAction(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const runForceSignout = async (reason: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/force-signout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const d = (await res.json().catch(() => null)) as {
        deletedSessions?: number;
        error?: string;
      } | null;
      if (!res.ok) throw new Error(d?.error ?? `Status ${res.status}`);
      toast.success(`Đã xoá ${d?.deletedSessions ?? 0} session.`);
      setAction(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const runImpersonate = async (reason: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, reason, durationMin: 30 }),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(d?.error ?? `Status ${res.status}`);
      toast.success('Đã bật impersonate (read-only, 30 phút). Mở /dashboard để xem banner.');
      setAction(null);
      router.push('/dashboard');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const initial = (u.name?.[0] ?? u.email[0] ?? '?').toUpperCase();

  return (
    <>
      <header className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-start gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={u.image ?? undefined} />
            <AvatarFallback className="bg-slate-800 text-lg text-slate-200">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-1">
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{u.name ?? 'Người dùng'}</h1>
              {isSelf && (
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                  Chính bạn
                </span>
              )}
            </div>
            <p className="font-mono text-xs text-slate-400">{u.email}</p>
            <p className="font-mono text-[10.5px] text-slate-500">ID: {u.id}</p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Pill kind={u.plan === 'TEAM' ? 'purple' : u.plan === 'PRO' ? 'blue' : 'slate'}>
                <Crown className="h-3 w-3" />
                {u.plan}
              </Pill>
              {u.adminRole && (
                <Pill kind="red">
                  <ShieldCheck className="h-3 w-3" />
                  {u.adminRole}
                </Pill>
              )}
              {u.suspendedAt ? (
                <Pill kind="red">
                  <UserX className="h-3 w-3" />
                  SUSPENDED
                </Pill>
              ) : (
                <Pill kind="emerald">
                  <UserCheck className="h-3 w-3" />
                  Active
                </Pill>
              )}
              {u.emailVerified && (
                <Pill kind="slate">
                  <Calendar className="h-3 w-3" />
                  Đăng ký {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                </Pill>
              )}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={isSelf}
                className="shrink-0"
                title={isSelf ? 'Không thể action chính mình' : 'Action menu'}
              >
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                Quản lý user
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {canMutate && (
                <>
                  {(['FREE', 'PRO', 'TEAM'] as const).map((p) => (
                    <DropdownMenuItem
                      key={p}
                      disabled={p === u.plan}
                      onClick={() => {
                        setPendingPlan(p);
                        setAction('change-plan');
                      }}
                    >
                      <Crown className="mr-2 h-3.5 w-3.5" />
                      Đổi plan → {p}
                      {p === u.plan && (
                        <span className="ml-auto text-[10px] text-slate-500">hiện tại</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => setAction('force-signout')}>
                <LogOut className="mr-2 h-3.5 w-3.5" />
                Force sign-out
              </DropdownMenuItem>
              {canMutate && !u.suspendedAt && (
                <DropdownMenuItem
                  onClick={() => setAction('impersonate')}
                  className="text-blue-300 focus:bg-blue-500/10 focus:text-blue-200"
                >
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                  View as user (read-only)
                </DropdownMenuItem>
              )}
              {canMutate && (
                <>
                  <DropdownMenuSeparator />
                  {u.suspendedAt ? (
                    <DropdownMenuItem
                      onClick={() => setAction('unsuspend')}
                      className="text-emerald-400 focus:bg-emerald-500/10 focus:text-emerald-300"
                    >
                      <UserCheck className="mr-2 h-3.5 w-3.5" />
                      Unsuspend
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => setAction('suspend')}
                      className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
                    >
                      <UserX className="mr-2 h-3.5 w-3.5" />
                      Suspend
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {u.suspendedAt && u.suspendReason && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
            <div className="text-xs">
              <p className="font-semibold text-red-300">
                Suspended {new Date(u.suspendedAt).toLocaleString('vi-VN')}
              </p>
              <p className="mt-0.5 text-red-300/80">Lý do: {u.suspendReason}</p>
            </div>
          </div>
        )}
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={FileText} label="Documents" value={data.stats.docs} />
        <StatTile icon={MessageSquare} label="Conversations" value={data.stats.conversations} />
        <StatTile icon={Zap} label="Flashcards" value={data.stats.flashcards} />
        <StatTile icon={Users} label="Groups" value={data.stats.groups} />
        <StatTile icon={TrendingUp} label="XP" value={data.stats.xp} />
        <StatTile
          icon={Flame}
          label="Streak hiện tại"
          value={data.stats.currentStreak}
          suffix={data.stats.currentStreak > 0 ? 'ngày' : null}
        />
        <StatTile
          icon={TrendingDown}
          label="Streak dài nhất"
          value={data.stats.longestStreak}
          suffix={data.stats.longestStreak > 0 ? 'ngày' : null}
        />
        <StatTile
          icon={Calendar}
          label="Hoạt động cuối"
          value={
            data.stats.lastActivityDate
              ? new Date(data.stats.lastActivityDate).toLocaleDateString('vi-VN', {
                  day: '2-digit',
                  month: '2-digit',
                })
              : '—'
          }
        />
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">
          Audit log tác động lên user này (10 mới nhất)
        </h2>
        {data.recentAudit.length === 0 ? (
          <EmptyState
            compact
            icon={ScrollText}
            title="Chưa có hành động admin nào trên user này."
          />
        ) : (
          <ul className="divide-y divide-slate-800">
            {data.recentAudit.map((row) => {
              const reason = (row.payload as { reason?: string })?.reason;
              return (
                <li key={row.id} className="flex items-start gap-3 py-2">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-300">
                    {row.action}
                  </span>
                  <div className="min-w-0 flex-1">
                    {reason && <p className="truncate text-xs text-slate-300">{reason}</p>}
                    <p className="font-mono text-[10.5px] text-slate-500">
                      bởi <span className="text-slate-400">{row.adminId.slice(0, 8)}…</span> ·{' '}
                      {new Date(row.createdAt).toLocaleString('vi-VN')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={action === 'suspend'}
        onOpenChange={(o) => !o && setAction(null)}
        title={`Suspend ${u.name ?? u.email}?`}
        description={
          <>
            User sẽ KHÔNG đăng nhập được. Toàn bộ session hiện tại bị xoá ngay. Data giữ nguyên — có
            thể restore bất kỳ lúc nào qua nút Unsuspend.
          </>
        }
        confirmLabel="Suspend"
        variant="destructive"
        loading={loading}
        onConfirm={runSuspend}
      />
      <ConfirmDialog
        open={action === 'unsuspend'}
        onOpenChange={(o) => !o && setAction(null)}
        title={`Restore ${u.name ?? u.email}?`}
        description="User sẽ đăng nhập được trở lại. Reason sẽ ghi audit log để giải trình."
        confirmLabel="Restore"
        variant="warning"
        loading={loading}
        onConfirm={runUnsuspend}
      />
      <ConfirmDialog
        open={action === 'change-plan'}
        onOpenChange={(o) => !o && setAction(null)}
        title={`Đổi plan sang ${pendingPlan}?`}
        description={
          <>
            Plan hiện tại: <span className="font-mono font-semibold">{u.plan}</span> →{' '}
            <span className="font-mono font-semibold">{pendingPlan}</span>. Ảnh hưởng tới rate limit
            + feature gate.
          </>
        }
        confirmLabel={`Đổi sang ${pendingPlan}`}
        variant="warning"
        loading={loading}
        onConfirm={runChangePlan}
      />
      <ConfirmDialog
        open={action === 'force-signout'}
        onOpenChange={(o) => !o && setAction(null)}
        title={`Force sign-out ${u.name ?? u.email}?`}
        description={
          <>
            Xoá TOÀN BỘ session active của user. User vẫn đăng nhập lại được. Dùng khi nghi
            credential leak hoặc user báo cáo có người khác truy cập.
          </>
        }
        confirmLabel="Force sign-out"
        variant="warning"
        loading={loading}
        onConfirm={runForceSignout}
      />

      <ConfirmDialog
        open={action === 'impersonate'}
        onOpenChange={(o) => !o && setAction(null)}
        title={`Impersonate ${u.name ?? u.email}?`}
        description={
          <>
            Bật chế độ <strong>read-only impersonate</strong> trong 30 phút. Banner đỏ sẽ hiện ở mọi
            page; mọi mutation bị middleware chặn 403. Audit log ghi lại start + stop. Phase 6 V1
            KHÔNG swap session — admin vẫn login tài khoản admin, đây chỉ là forensic primitive.
          </>
        }
        confirmLabel="Bật impersonate"
        variant="warning"
        loading={loading}
        onConfirm={runImpersonate}
      />
    </>
  );
}

function Pill({
  kind,
  children,
}: {
  kind: 'red' | 'amber' | 'emerald' | 'blue' | 'purple' | 'slate';
  children: React.ReactNode;
}) {
  const colors: Record<typeof kind, string> = {
    red: 'border-red-500/30 bg-red-500/10 text-red-400',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
    purple: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    slate: 'border-slate-700/40 bg-slate-700/20 text-slate-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-semibold',
        colors[kind],
      )}
    >
      {children}
    </span>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: typeof FileText;
  label: string;
  value: number | string;
  suffix?: string | null;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums text-slate-100">
          {typeof value === 'number' ? value.toLocaleString('vi-VN') : value}
        </span>
        {suffix && <span className="text-[10.5px] text-slate-500">{suffix}</span>}
      </div>
    </div>
  );
}
