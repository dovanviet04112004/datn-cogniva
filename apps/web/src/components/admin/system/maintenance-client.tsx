/**
 * MaintenanceClient — toggle maintenance mode + edit banner.
 *
 * UX:
 *   - Tile lớn hiển thị state hiện tại (enabled = đỏ, disabled = xanh)
 *   - Toggle switch + textarea banner + checkbox dismissible
 *   - Submit yêu cầu reason ≥ 10 chars (audit log)
 *   - Preview banner ngay khi nhập (giả lập app shell)
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Hammer, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { cn } from '@/lib/utils';

type Config = {
  enabled: boolean;
  banner: string | null;
  dismissible: boolean;
};

export function MaintenanceClient({ initial }: { initial: Config }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<Config>(initial);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const dirty =
    draft.enabled !== initial.enabled ||
    (draft.banner ?? '') !== (initial.banner ?? '') ||
    draft.dismissible !== initial.dismissible;

  const submit = async (reason: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/system/maintenance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? 'Cập nhật thất bại');
      }
      toast.success('Đã cập nhật maintenance config');
      setConfirmOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cập nhật thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Hammer className="h-5 w-5 text-amber-400" />
          Maintenance mode
        </h1>
        <p className="text-sm text-slate-400">
          Bật/tắt maintenance + edit banner hiển thị cho toàn app. Cache 5s nên
          banner mới sẽ propagate sau ~5s khi enable. Chỉ <strong>SUPER_ADMIN</strong>{' '}
          dùng được.
        </p>
      </header>

      {/* Current state */}
      <section
        className={cn(
          'rounded-xl border p-4',
          initial.enabled
            ? 'border-red-500/40 bg-red-500/5'
            : 'border-emerald-500/30 bg-emerald-500/5',
        )}
      >
        <div className="flex items-center gap-2">
          {initial.enabled ? (
            <>
              <AlertCircle className="h-4 w-4 text-red-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-red-300">
                Maintenance ACTIVE
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                Hoạt động bình thường
              </span>
            </>
          )}
        </div>
        {initial.enabled && initial.banner && (
          <p className="mt-2 text-[12.5px] text-slate-200">{initial.banner}</p>
        )}
      </section>

      {/* Editor */}
      <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/30 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-slate-100">Bật maintenance</p>
            <p className="text-[11px] text-slate-500">
              Bật = hiện banner cảnh báo. KHÔNG block traffic — chỉ thông báo.
            </p>
          </div>
          <Toggle
            checked={draft.enabled}
            onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-300">
            Banner text{' '}
            <span className="font-mono text-[10px] text-slate-500">
              (HTML không hỗ trợ; max 500 ký tự)
            </span>
          </label>
          <textarea
            value={draft.banner ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, banner: e.target.value || null }))}
            rows={3}
            maxLength={500}
            placeholder="vd: Hệ thống sẽ bảo trì 23:00 - 24:00 ngày 21/05. Một số tính năng có thể chậm."
            className="mt-1 w-full resize-none rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-500/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          />
          <p className="text-right font-mono text-[10px] text-slate-500">
            {(draft.banner ?? '').length}/500
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-slate-100">Cho phép dismiss</p>
            <p className="text-[11px] text-slate-500">
              User có thể đóng banner trong session. Tắt → banner cố định cho đến
              khi admin tắt maintenance.
            </p>
          </div>
          <Toggle
            checked={draft.dismissible}
            onChange={(v) => setDraft((d) => ({ ...d, dismissible: v }))}
          />
        </div>
      </section>

      {/* Preview */}
      {draft.enabled && draft.banner && (
        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Preview (banner hiển thị thế này trong app)
          </p>
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12.5px] text-amber-100">
            <p className="flex items-center gap-2">
              <Hammer className="h-3.5 w-3.5 shrink-0 text-amber-300" />
              {draft.banner}
            </p>
          </div>
        </section>
      )}

      {/* Submit */}
      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <button
            onClick={() => setDraft(initial)}
            disabled={loading}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            Reset
          </button>
        )}
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={!dirty || loading}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
            dirty
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'cursor-not-allowed bg-slate-800 text-slate-500',
          )}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Áp dụng
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={draft.enabled ? 'Bật maintenance mode?' : 'Tắt maintenance mode?'}
        description={
          draft.enabled
            ? `Banner sẽ hiển thị cho TOÀN BỘ user trong vòng ~5s. ${draft.dismissible ? 'User có thể dismiss.' : 'User KHÔNG dismiss được.'} Audit log ghi reason.`
            : 'Banner sẽ biến mất khỏi app shell. Audit log ghi reason để track ai tắt khi nào.'
        }
        confirmLabel="Áp dụng"
        variant="warning"
        loading={loading}
        onConfirm={submit}
      />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors',
        checked
          ? 'border-amber-500/50 bg-amber-500/30'
          : 'border-slate-700 bg-slate-800',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 translate-y-[1px] rounded-full bg-slate-100 transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
