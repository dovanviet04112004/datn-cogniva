/**
 * ImpersonationBannerClient — banner đỏ + countdown TTL + Stop button.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export function ImpersonationBannerClient({
  adminEmail,
  targetEmail,
  expiresAt,
  mode,
}: {
  adminEmail: string;
  targetEmail: string;
  expiresAt: number;
  mode: 'readonly' | 'full';
}) {
  const router = useRouter();
  const [remaining, setRemaining] = React.useState(() =>
    Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  );
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  // Auto refresh khi hết hạn để clear banner (cookie expired ở server)
  React.useEffect(() => {
    if (remaining === 0) {
      router.refresh();
    }
  }, [remaining, router]);

  const stop = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/impersonate', { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Đã dừng impersonation');
      router.refresh();
      router.push('/admin/users');
    } catch {
      toast.error('Stop thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-[12px] text-destructive"
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
      <div className="flex-1">
        <p className="font-semibold">
          Đang impersonate{' '}
          <code className="rounded bg-destructive/15 px-1 font-mono text-[11px]">
            {targetEmail}
          </code>{' '}
          {mode === 'readonly' && (
            <span className="ml-1 inline-flex items-center rounded-full bg-destructive/20 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider">
              read-only
            </span>
          )}
        </p>
        <p className="text-[11px] opacity-90">
          Admin: <code className="font-mono text-[11px]">{adminEmail}</code> · Hết
          hạn sau{' '}
          <span className="font-mono tabular-nums">
            {formatRemaining(remaining)}
          </span>
        </p>
      </div>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={stop}
        disabled={loading}
        className="h-8 gap-1 px-2.5"
      >
        <LogOut className="h-3 w-3" />
        Stop impersonate
      </Button>
    </div>
  );
}

function formatRemaining(sec: number): string {
  if (sec <= 0) return 'expired';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}
