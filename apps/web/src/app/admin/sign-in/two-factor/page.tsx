'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { signInTwoFactor, TWO_FACTOR_CHALLENGE_KEY } from '@/lib/auth-api';
import { cn } from '@/lib/utils';

export default function TwoFactorChallengePage() {
  const router = useRouter();
  const search = useSearchParams();
  const redirectTo = search.get('redirect') ?? '/admin';
  const [mode, setMode] = React.useState<'totp' | 'backup'>('totp');
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!sessionStorage.getItem(TWO_FACTOR_CHALLENGE_KEY)) {
      toast.error('Phiên xác minh hết hạn — đăng nhập lại.');
      router.replace('/admin/sign-in');
    }
  }, [router]);

  const verify = async () => {
    if (loading) return;
    if (mode === 'totp' && code.length !== 6) {
      toast.error('Code TOTP 6 chữ số');
      return;
    }
    if (mode === 'backup' && code.trim().length < 4) {
      toast.error('Backup code không hợp lệ');
      return;
    }
    const challengeToken = sessionStorage.getItem(TWO_FACTOR_CHALLENGE_KEY);
    if (!challengeToken) {
      router.replace('/admin/sign-in');
      return;
    }
    setLoading(true);
    try {
      const result = await signInTwoFactor(challengeToken, code.trim());
      if (!result.ok) throw new Error(result.error);
      sessionStorage.removeItem(TWO_FACTOR_CHALLENGE_KEY);
      toast.success('Đăng nhập thành công');
      router.push(redirectTo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verify thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-100">Xác minh 2 bước</h1>
          <p className="text-center text-[12px] text-slate-400">
            Nhập code 6 chữ số từ app TOTP để tiếp tục.
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-300">
            {mode === 'totp' ? 'Code TOTP' : 'Backup code'}
          </label>
          <input
            type="text"
            inputMode={mode === 'totp' ? 'numeric' : 'text'}
            pattern={mode === 'totp' ? '[0-9]{6}' : undefined}
            maxLength={mode === 'totp' ? 6 : 11}
            value={code}
            onChange={(e) =>
              setCode(mode === 'totp' ? e.target.value.replace(/\D/g, '') : e.target.value)
            }
            placeholder={mode === 'totp' ? '123456' : 'xxxxx-xxxxx'}
            autoFocus
            autoComplete="one-time-code"
            onKeyDown={(e) => e.key === 'Enter' && verify()}
            className={cn(
              'mt-1 h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-center font-mono text-slate-100 focus:border-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/20',
              mode === 'totp' && 'text-xl tracking-[0.4em]',
            )}
          />
        </div>

        <button
          onClick={verify}
          disabled={loading || (mode === 'totp' && code.length !== 6)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-2 text-[13px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Xác nhận
        </button>

        <div className="flex items-center justify-between text-[11px]">
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'totp' ? 'backup' : 'totp');
              setCode('');
            }}
            className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
          >
            <KeyRound className="h-3 w-3" />
            {mode === 'totp' ? 'Dùng backup code' : 'Dùng code TOTP'}
          </button>
          <Link href="/admin/sign-in" className="text-slate-500 hover:text-slate-300">
            Về sign-in
          </Link>
        </div>
      </div>
    </div>
  );
}
