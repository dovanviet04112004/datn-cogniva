/**
 * TwoFactorClient — enroll/disable TOTP cho admin account.
 *
 * Flow enroll:
 *   1. Nhập password admin → POST /two-factor/enable → trả totpURI + backupCodes
 *   2. Hiện QR (URL ngoài → render qua google chart) + secret + backup codes
 *   3. User scan QR + nhập code 6 chữ số → /two-factor/verify-totp → done
 *
 * Flow disable:
 *   1. Nhập password → /two-factor/disable → cleared
 *
 * Phase 6 V1 dùng QR external service (api.qrserver.com) — Phase 6.1 wire
 * `qrcode` package server-side để self-hosted.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Copy,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

type Props = {
  enabled: boolean;
};

export function TwoFactorClient({ enabled }: Props) {
  const router = useRouter();
  const [step, setStep] = React.useState<'idle' | 'enrolling' | 'verifying'>('idle');
  const [password, setPassword] = React.useState('');
  const [totpUri, setTotpUri] = React.useState<string | null>(null);
  const [backupCodes, setBackupCodes] = React.useState<string[]>([]);
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const startEnroll = async () => {
    if (!password) {
      toast.error('Cần password để bật 2FA');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data) throw new Error(error?.message ?? 'Enable thất bại');
      setTotpUri(data.totpURI);
      setBackupCodes(data.backupCodes ?? []);
      setStep('verifying');
      setPassword('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Enable thất bại');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 6) {
      toast.error('Code 2FA 6 chữ số');
      return;
    }
    setLoading(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code });
      if (error) throw new Error(error.message ?? 'Code sai');
      toast.success('Đã bật 2FA. Lần đăng nhập tới sẽ yêu cầu code.');
      setStep('idle');
      setTotpUri(null);
      setBackupCodes([]);
      setCode('');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verify thất bại');
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    if (!password) {
      toast.error('Cần password để tắt 2FA');
      return;
    }
    setLoading(true);
    try {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) throw new Error(error.message ?? 'Disable thất bại');
      toast.success('Đã tắt 2FA. Bảo mật giảm — bật lại sớm.');
      setPassword('');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Disable thất bại');
    } finally {
      setLoading(false);
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      toast.success('Đã copy backup codes');
    } catch {
      toast.error('Copy lỗi');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          2FA TOTP
        </h1>
        <p className="text-sm text-slate-400">
          Bật 2FA tăng bảo mật tài khoản admin. App TOTP (Google Authenticator,
          Authy, 1Password) sẽ sinh code 6 chữ số mỗi 30s.
        </p>
      </header>

      {/* Status card */}
      <section
        className={cn(
          'rounded-xl border p-5',
          enabled
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-amber-500/30 bg-amber-500/5',
        )}
      >
        <div className="flex items-center gap-2">
          {enabled ? (
            <>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                2FA đang BẬT
              </span>
            </>
          ) : (
            <>
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-amber-300">
                2FA TẮT
              </span>
            </>
          )}
        </div>
        <p className="mt-2 text-[12.5px] text-slate-300">
          {enabled
            ? 'Mọi lần sign-in admin sẽ cần password + code TOTP.'
            : 'Khuyến nghị bật ngay cho tài khoản SUPER_ADMIN / ADMIN.'}
        </p>
      </section>

      {/* Enroll flow */}
      {!enabled && step === 'idle' && (
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/30 p-5">
          <h2 className="text-sm font-semibold tracking-tight">Bật 2FA</h2>
          <div>
            <label className="block text-[11px] font-medium text-slate-300">
              Password hiện tại <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 h-9 w-full max-w-sm rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 focus:border-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <button
            onClick={startEnroll}
            disabled={loading || !password}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            Bật 2FA
          </button>
        </section>
      )}

      {!enabled && step === 'verifying' && totpUri && (
        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/30 p-5">
          <h2 className="text-sm font-semibold tracking-tight">
            Bước 1: Scan QR vào app TOTP
          </h2>
          <div className="flex flex-col items-center gap-3">
            {/* QR via external service — Phase 6.1 self-host bằng `qrcode` pkg */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(totpUri)}`}
              alt="QR code TOTP"
              width={220}
              height={220}
              className="rounded-lg border border-slate-700 bg-white p-2"
            />
            <details className="w-full">
              <summary className="cursor-pointer text-center text-[11px] text-slate-500 hover:text-slate-300">
                Không scan được? Hiện URI manual
              </summary>
              <pre className="mt-2 max-w-full overflow-x-auto rounded-md bg-slate-950 p-2 font-mono text-[10px] text-slate-400">
                {totpUri}
              </pre>
            </details>
          </div>

          {backupCodes.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                  Backup codes (lưu lại!)
                </h3>
                <button
                  onClick={copyCodes}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10.5px] text-amber-200 hover:bg-amber-500/20"
                >
                  <Copy className="h-2.5 w-2.5" />
                  Copy
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1 font-mono text-[11px] text-amber-100">
                {backupCodes.map((c) => (
                  <code key={c} className="rounded bg-amber-500/10 px-2 py-1">
                    {c}
                  </code>
                ))}
              </div>
              <p className="mt-2 text-[10.5px] text-amber-200/80">
                Mỗi code dùng 1 lần khi mất phone. Lưu vào password manager NGAY.
              </p>
            </div>
          )}

          <div>
            <h3 className="text-[12px] font-semibold tracking-tight">
              Bước 2: Nhập code 6 chữ số từ app
            </h3>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              autoComplete="one-time-code"
              className="mt-2 h-10 w-32 rounded-md border border-slate-800 bg-slate-950 px-3 text-center font-mono text-lg tracking-[0.3em] text-slate-100 focus:border-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={verifyCode}
                disabled={loading || code.length !== 6}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Xác nhận + bật
              </button>
              <button
                onClick={() => {
                  setStep('idle');
                  setTotpUri(null);
                  setBackupCodes([]);
                  setCode('');
                }}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-[12px] text-slate-300 hover:bg-slate-800"
              >
                Huỷ
              </button>
            </div>
          </div>
        </section>
      )}

      {enabled && (
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/30 p-5">
          <h2 className="text-sm font-semibold tracking-tight">Tắt 2FA</h2>
          <p className="text-[12px] text-slate-400">
            Cần password để xác minh. Sau khi tắt, sign-in chỉ cần password — bảo mật
            giảm.
          </p>
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-300">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1 h-9 w-full max-w-sm rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              />
            </div>
            <button
              onClick={disable}
              disabled={loading || !password}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Tắt 2FA
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
