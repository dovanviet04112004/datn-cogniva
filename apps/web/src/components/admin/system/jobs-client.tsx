'use client';

import { Calendar, CheckCircle2, ClipboardList, Layers, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

type QueueCounts = { name: string; counts: Record<string, number> };
type Cron = { id: string; pattern: string };

type Props = {
  queues: QueueCounts[];
  crons: Cron[];
  redisConfigured: boolean;
  redisOk: boolean;
};

const COUNT_KEYS = ['active', 'waiting', 'delayed', 'completed', 'failed'] as const;

export function JobsClient({ queues, crons, redisConfigured, redisOk }: Props) {
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardList className="h-5 w-5 text-purple-400" />
          Background jobs
        </h1>
        <p className="text-sm text-slate-400">
          Hàng đợi <strong>BullMQ</strong> (Redis). Worker chạy{' '}
          <code>pnpm --filter @cogniva/web worker</code>. Cron là repeatable jobs trên queue{' '}
          <code>cron</code>.
        </p>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Redis
        </h2>
        <div className="flex items-center gap-2 text-sm">
          {redisConfigured && redisOk ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-emerald-300">Kết nối OK</span>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-amber-400" />
              <span className="text-amber-300">
                {redisConfigured ? 'Không kết nối được Redis' : 'REDIS_URL chưa set'}
              </span>
            </>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/30">
        <header className="border-b border-slate-800 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Layers className="h-4 w-4 text-blue-400" />
            Queues ({queues.length})
          </h2>
        </header>
        <ul className="divide-y divide-slate-800/60">
          {queues.length === 0 ? (
            <li className="px-4 py-6 text-center text-[12px] text-slate-500">
              Không lấy được số liệu (Redis down hoặc worker chưa từng chạy).
            </li>
          ) : (
            queues.map((q) => (
              <li key={q.name} className="px-4 py-3">
                <code className="font-mono text-[12.5px] font-semibold text-slate-100">
                  {q.name}
                </code>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {COUNT_KEYS.map((k) => (
                    <CountTile key={k} label={k} value={q.counts[k] ?? 0} />
                  ))}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/30">
        <header className="border-b border-slate-800 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Calendar className="h-4 w-4 text-purple-400" />
            Cron schedules ({crons.length}) — giờ UTC
          </h2>
        </header>
        <ul className="divide-y divide-slate-800/60">
          {crons.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <code className="font-mono text-[12.5px] font-semibold text-slate-100">{c.id}</code>
              <code className="shrink-0 rounded bg-purple-500/10 px-1.5 py-0.5 font-mono text-[10.5px] text-purple-300">
                {c.pattern}
              </code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  const tone =
    label === 'failed' && value > 0
      ? 'text-red-300'
      : label === 'active' && value > 0
        ? 'text-emerald-300'
        : 'text-slate-300';
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-2 text-center">
      <p className={cn('font-mono text-base font-semibold', tone)}>{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
    </div>
  );
}
