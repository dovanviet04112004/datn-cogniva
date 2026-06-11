'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Save, ToggleRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { usePrompt } from '@/lib/use-confirm';
import { cn } from '@/lib/utils';

type Flag = {
  name: string;
  value: unknown;
  updatedAt: string;
  updatedBy: string | null;
};

export function FlagsClient({ initial }: { initial: Flag[] }) {
  const router = useRouter();
  const askPrompt = usePrompt();
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState<string>('');
  const [editLoading, setEditLoading] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [deleteFlag, setDeleteFlag] = React.useState<Flag | null>(null);

  const { data: flags = initial, refetch } = useQuery({
    queryKey: qk.adminFlags(),
    queryFn: () => apiGet<{ flags: Flag[] }>('/api/admin/system/flags').then((d) => d.flags),
    initialData: initial,
  });

  const startEdit = (f: Flag) => {
    setExpanded(f.name);
    setEditValue(JSON.stringify(f.value, null, 2));
  };

  const saveEdit = async (name: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(editValue);
    } catch {
      toast.error('JSON không hợp lệ');
      return;
    }
    const reason = await askPrompt({
      title: 'Lý do cập nhật flag',
      description: 'Tối thiểu 10 ký tự.',
      placeholder: 'Nhập lý do…',
      required: true,
      multiline: true,
    });
    if (reason === null) return;
    if (!reason || reason.trim().length < 10) {
      toast.error('Reason cần ≥ 10 ký tự');
      return;
    }
    setEditLoading(true);
    try {
      const res = await fetch('/api/admin/system/flags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, value: parsed, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? 'Save thất bại');
      }
      toast.success(`Đã cập nhật flag "${name}"`);
      setExpanded(null);
      await refetch();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save thất bại');
    } finally {
      setEditLoading(false);
    }
  };

  const doDelete = async (reason: string) => {
    if (!deleteFlag) return;
    try {
      const res = await fetch(
        `/api/admin/system/flags?name=${encodeURIComponent(deleteFlag.name)}&reason=${encodeURIComponent(reason)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? 'Delete thất bại');
      }
      toast.success(`Đã xoá flag "${deleteFlag.name}"`);
      setDeleteFlag(null);
      await refetch();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete thất bại');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ToggleRight className="h-5 w-5 text-blue-400" />
            Feature flags
          </h1>
          <button
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-600"
          >
            <Plus className="h-3.5 w-3.5" />
            Flag mới
          </button>
        </div>
        <p className="text-sm text-slate-400">
          Lưu ở <code>system_config</code> key <code>flags.&lt;name&gt;</code>. Code đọc qua{' '}
          <code>getFlag&lt;T&gt;(name)</code>. Cache 5s nên flag mới propagate sau ~5s.
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
        {flags.length === 0 ? (
          <p className="px-5 py-12 text-center text-xs text-slate-500">
            Chưa có flag nào. Click &quot;Flag mới&quot; để tạo.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {flags.map((f) => (
              <li key={f.name}>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => (expanded === f.name ? setExpanded(null) : startEdit(f))}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <code className="font-mono text-[12.5px] font-semibold text-slate-100">
                      {f.name}
                    </code>
                    <span
                      className={cn(
                        'truncate font-mono text-[10.5px]',
                        typeof f.value === 'boolean'
                          ? f.value
                            ? 'text-emerald-400'
                            : 'text-slate-500'
                          : 'text-slate-400',
                      )}
                    >
                      {valueSummary(f.value)}
                    </span>
                  </button>
                  <span className="font-mono text-[10px] text-slate-500">
                    {new Date(f.updatedAt).toLocaleString('vi-VN', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <button
                    onClick={() => setDeleteFlag(f)}
                    className="rounded-md p-1 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    aria-label="Xoá flag"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {expanded === f.name && (
                  <div className="space-y-2 border-t border-slate-800/60 bg-slate-950/40 px-4 py-3">
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      rows={6}
                      className="w-full resize-y rounded-md border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[11.5px] text-slate-100 focus:border-blue-500/40 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      placeholder='vd: true / 42 / "preview" / {"enabled": true, "ratio": 0.5}'
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setExpanded(null)}
                        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                      >
                        Huỷ
                      </button>
                      <button
                        onClick={() => saveEdit(f.name)}
                        disabled={editLoading}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-500 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                      >
                        {editLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        Lưu
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewFlagDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={async () => {
          setNewOpen(false);
          await refetch();
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={!!deleteFlag}
        onOpenChange={(o) => !o && setDeleteFlag(null)}
        title={`Xoá flag "${deleteFlag?.name}"?`}
        description={
          <span>
            Code đọc qua <code>getFlag()</code> sẽ trả về <strong>null</strong> sau khi xoá → fall
            back về default behavior. Action không thể undo qua admin UI.
          </span>
        }
        confirmLabel="Xoá flag"
        variant="destructive"
        onConfirm={doDelete}
      />
    </div>
  );
}

function NewFlagDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = React.useState('');
  const [value, setValue] = React.useState('true');
  const [reason, setReason] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setName('');
        setValue('true');
        setReason('');
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  const submit = async () => {
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      toast.error('Value phải là JSON hợp lệ');
      return;
    }
    if (!/^[a-z][a-z0-9_-]{0,59}$/.test(name)) {
      toast.error('Tên flag phải kebab-case (a-z, 0-9, _, -)');
      return;
    }
    if (reason.trim().length < 10) {
      toast.error('Reason cần ≥ 10 ký tự');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/system/flags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, value: parsedValue, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? 'Tạo thất bại');
      }
      toast.success(`Đã tạo flag "${name}"`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Tạo thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Flag mới</DialogTitle>
          <DialogDescription className="text-xs">
            Tên kebab-case, value là JSON hợp lệ. Code đọc qua <code>getFlag&lt;T&gt;(name)</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-300">Tên (kebab-case)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="vd: new-onboarding-flow"
              className="mt-1 h-9 w-full rounded-md border border-slate-800 bg-slate-950 px-3 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-300">Value (JSON)</label>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={4}
              className="mt-1 w-full resize-y rounded-md border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[11.5px] text-slate-100 focus:border-blue-500/40 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-300">
              Lý do <span className="text-red-400">*</span>
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="mt-1 h-9 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="vd: Bật onboarding mới cho 10% user (A/B test)"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Huỷ
          </Button>
          <Button
            onClick={submit}
            disabled={loading}
            className="bg-blue-500 text-white hover:bg-blue-600"
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Đang tạo…
              </>
            ) : (
              <>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Tạo flag
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function valueSummary(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `"${v.slice(0, 30)}${v.length > 30 ? '…' : ''}"`;
  return JSON.stringify(v).slice(0, 60);
}
