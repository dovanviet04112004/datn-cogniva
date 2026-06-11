'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, ShieldCheck, Eye, Ban } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/use-confirm';

type AttemptRow = {
  id: string;
  userId: string;
  userName: string;
  status: string;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  cheatRiskScore: number | null;
  flagged: boolean;
  flagReason: string | null;
  violationCount: number;
};

type Violation = {
  id: string;
  type: string;
  severity: string;
  metadata: Record<string, unknown> | null;
  timestamp: string;
};

export default function ProctorReviewPage() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();
  const [attempts, setAttempts] = React.useState<AttemptRow[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedViolations, setSelectedViolations] = React.useState<Violation[]>([]);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/exams/${id}/proctor`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { attempts: AttemptRow[] };
      setAttempts(data.attempts);
    } catch (err) {
      toast.error('Load fail: ' + (err as Error).message);
    }
  }, [id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function viewViolations(attemptId: string) {
    setSelectedId(attemptId);
    try {
      const res = await fetch(`/api/attempts/${attemptId}/violations`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { violations: Violation[] };
      setSelectedViolations(data.violations);
    } catch (err) {
      toast.error('Load violation fail: ' + (err as Error).message);
    }
  }

  async function disqualify(attemptId: string) {
    const ok = await confirm({
      title: 'Loại attempt này?',
      description: 'Hành động không hoàn tác.',
      confirmLabel: 'Disqualify',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/attempts/${attemptId}/disqualify`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success('Đã disqualify');
      void load();
    } catch (err) {
      toast.error('Disqualify fail: ' + (err as Error).message);
    }
  }

  if (!attempts) {
    return <div className="text-muted-foreground p-6">Đang tải...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Proctor Review</h1>
        <p className="text-muted-foreground text-sm">
          Xem cheat risk score + violation timeline của từng attempt.
        </p>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Student</th>
              <th className="px-3 py-2 font-medium">Bắt đầu</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Cheat Risk</th>
              <th className="px-3 py-2 font-medium">Violations</th>
              <th className="px-3 py-2 font-medium">Điểm</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {attempts.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted-foreground py-8 text-center">
                  Chưa có attempt nào.
                </td>
              </tr>
            )}
            {attempts.map((a) => (
              <tr key={a.id} className="hover:bg-accent/30 border-t">
                <td className="px-3 py-2">
                  <div className="font-medium">{a.userName}</div>
                  <div className="text-muted-foreground text-xs">{a.userId.slice(0, 8)}…</div>
                </td>
                <td className="px-3 py-2 text-xs">
                  {new Date(a.startedAt).toLocaleString('vi-VN')}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'rounded px-2 py-0.5 text-xs',
                      a.status === 'DISQUALIFIED'
                        ? 'bg-destructive/10 text-destructive'
                        : a.status === 'SUBMITTED'
                          ? 'bg-success/10 text-success'
                          : 'bg-muted',
                    )}
                  >
                    {a.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <CheatRiskBar score={a.cheatRiskScore} flagged={a.flagged} />
                </td>
                <td className="px-3 py-2 text-center font-mono">{a.violationCount}</td>
                <td className="px-3 py-2 font-mono">
                  {a.score !== null ? `${a.score.toFixed(1)}` : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => viewViolations(a.id)}
                      disabled={a.violationCount === 0}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    {a.status !== 'DISQUALIFIED' && (
                      <Button size="sm" variant="ghost" onClick={() => disqualify(a.id)}>
                        <Ban className="text-destructive h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {selectedId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedId(null)}
        >
          <Card
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Violation Timeline</h2>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                Đóng
              </Button>
            </div>
            {selectedViolations.length === 0 ? (
              <p className="text-muted-foreground text-sm">Không có violation.</p>
            ) : (
              <ul className="space-y-2">
                {selectedViolations.map((v) => (
                  <li
                    key={v.id}
                    className={cn(
                      'rounded-md border p-3 text-sm',
                      v.severity === 'high' && 'border-destructive/30 bg-destructive/5',
                      v.severity === 'medium' && 'border-orange-500/30 bg-orange-500/5',
                      v.severity === 'low' && 'border-yellow-500/30 bg-yellow-500/5',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{v.type}</span>
                      <span className="text-xs uppercase opacity-60">{v.severity}</span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(v.timestamp).toLocaleString('vi-VN')}
                    </div>
                    {v.metadata && Object.keys(v.metadata).length > 0 && (
                      <pre className="bg-background/50 mt-1 overflow-x-auto rounded p-1 text-[10px]">
                        {JSON.stringify(v.metadata, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function CheatRiskBar({ score, flagged }: { score: number | null; flagged: boolean }) {
  if (score === null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  const pct = Math.round(score * 100);
  const color = score > 0.7 ? 'bg-destructive' : score > 0.3 ? 'bg-orange-500' : 'bg-success';
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-2 w-20 overflow-hidden rounded-full">
        <div className={cn('h-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs">{pct}%</span>
      {flagged && (
        <span title="Auto-flagged" className="text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
        </span>
      )}
      {!flagged && score < 0.1 && (
        <span title="Clean" className="text-success">
          <ShieldCheck className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}
