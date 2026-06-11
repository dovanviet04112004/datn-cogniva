'use client';

import * as React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircuitBoard,
  Clock,
  Loader2,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import type { AdminRole } from '@cogniva/db';
import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';

import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 10_000;

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

type Circuit = {
  name: string;
  state: CircuitState;
  failCount: number;
  stateTtl: number;
};

export function CircuitsClient({ adminRole }: { adminRole: AdminRole }) {
  const canMutate = adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN';

  const [resetActive, setResetActive] = React.useState<Circuit | null>(null);
  const [resetLoading, setResetLoading] = React.useState(false);

  const {
    data: circuits = [],
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: qk.adminAiCircuits(),
    queryFn: () =>
      apiGet<{ circuits: Circuit[] }>('/api/admin/ai/circuits').then((d) => d.circuits),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const doReset = async (reason: string) => {
    if (!resetActive) return;
    setResetLoading(true);
    try {
      const res = await fetch('/api/admin/ai/circuits/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: resetActive.name, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? 'Reset thất bại');
      }
      toast.success(`Đã reset circuit ${resetActive.name}`);
      setResetActive(null);
      void refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset thất bại');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Circuit breakers</h1>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:bg-slate-800"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
        <p className="text-sm text-slate-400">
          State machine per (provider, model). Auto-refresh 10s. Circuit healthy không có entry
          trong Redis → list trống = ✅ tất cả OK.
        </p>
      </header>

      {loading ? (
        <div className="py-12 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
        </div>
      ) : circuits.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-400" />
          <p className="mt-2 text-sm font-medium text-emerald-200">Mọi circuit đang CLOSED</p>
          <p className="mt-1 text-[12px] text-slate-400">
            Không có provider nào fail gần đây. Bảng này tự update khi có circuit mở.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {circuits.map((c) => (
            <CircuitCard
              key={c.name}
              c={c}
              canReset={canMutate && c.state !== 'CLOSED'}
              onReset={() => setResetActive(c)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!resetActive}
        onOpenChange={(o) => !o && setResetActive(null)}
        title={`Force CLOSE circuit "${resetActive?.name}"?`}
        description={
          <span>
            Circuit hiện đang <strong>{resetActive?.state}</strong>. Reset = đặt CLOSED ngay, cho
            phép request đi qua provider. Chỉ dùng khi đã verify provider phục hồi để tránh dồn
            request vào dịch vụ còn down.
          </span>
        }
        confirmLabel="Reset CLOSED"
        variant="warning"
        loading={resetLoading}
        onConfirm={doReset}
      />
    </div>
  );
}

function CircuitCard({
  c,
  canReset,
  onReset,
}: {
  c: Circuit;
  canReset: boolean;
  onReset: () => void;
}) {
  const cfg = {
    CLOSED: {
      cls: 'border-emerald-500/30 bg-emerald-500/5',
      Icon: CheckCircle2,
      iconCls: 'text-emerald-400',
      label: 'CLOSED',
      labelCls: 'text-emerald-300',
    },
    HALF_OPEN: {
      cls: 'border-amber-500/30 bg-amber-500/5',
      Icon: Zap,
      iconCls: 'text-amber-400',
      label: 'HALF_OPEN',
      labelCls: 'text-amber-300',
    },
    OPEN: {
      cls: 'border-red-500/40 bg-red-500/10',
      Icon: AlertCircle,
      iconCls: 'text-red-400',
      label: 'OPEN',
      labelCls: 'text-red-300',
    },
  }[c.state];
  const Icon = cfg.Icon;

  return (
    <article className={cn('rounded-lg border p-4', cfg.cls)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CircuitBoard className="h-4 w-4 text-slate-400" />
            <p className="truncate font-mono text-[12.5px] font-semibold text-slate-100">
              {c.name}
            </p>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full bg-slate-900/60 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider',
                cfg.labelCls,
              )}
            >
              <Icon className={cn('h-2.5 w-2.5', cfg.iconCls)} />
              {cfg.label}
            </span>
            {c.failCount > 0 && (
              <span className="font-mono text-[10.5px] text-slate-400">
                {c.failCount} fails trong window
              </span>
            )}
          </div>
          {c.stateTtl > 0 && (
            <p className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10.5px] text-slate-500">
              <Clock className="h-2.5 w-2.5" />
              TTL còn {c.stateTtl}s
            </p>
          )}
        </div>
        {canReset && (
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/15"
          >
            <RefreshCw className="h-3 w-3" />
            Reset
          </button>
        )}
      </div>
    </article>
  );
}
