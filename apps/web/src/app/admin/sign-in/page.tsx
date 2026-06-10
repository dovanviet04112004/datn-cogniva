/**
 * /admin/sign-in — form đăng nhập riêng cho admin.
 *
 * Reuse Better Auth credential sign-in (cùng API với /sign-in của product)
 * — nhưng UI hoàn toàn khác: dark theme, banner cảnh báo, không gợi ý
 * sign-up. Sau khi sign-in thành công + có adminRole, /admin/(authed)
 * layout sẽ pass; nếu không có role, /admin redirect lại đây với toast.
 *
 * Không reuse component <SignInForm> của product để giữ visual tách biệt.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';

export const dynamic = 'force-dynamic';

export default function AdminSignInPage() {
  const router = useRouter();
  const search = useSearchParams();
  const redirectTo = search.get('redirect') ?? '/admin';

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      const { error } = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(error.message ?? 'Sai email hoặc mật khẩu');
      // Authorization sẽ check ở /admin layout — nếu user không có adminRole
      // sẽ redirect lại đây. Toast guide.
      router.replace(redirectTo);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-red-500/20 to-amber-500/10 ring-1 ring-inset ring-red-500/30">
            <ShieldCheck className="h-5 w-5 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Cogniva Admin</h1>
          <p className="text-xs text-slate-400">
            Khu vực quản trị nội bộ. Đăng nhập bằng tài khoản có quyền admin.
          </p>
        </div>

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-snug text-amber-200/90">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span>
              Mọi hành động trong admin console được ghi audit log. Đăng nhập
              chỉ khi được uỷ quyền.
            </span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              placeholder="admin@cogniva.app"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium text-slate-300">
              Mật khẩu
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-red-500 px-3 text-sm font-semibold text-slate-50 transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Đang đăng nhập…
              </>
            ) : (
              'Đăng nhập'
            )}
          </button>
        </form>

        <div className="text-center text-[11px] text-slate-500">
          Không có quyền admin?{' '}
          <Link href="/dashboard" className="text-slate-300 hover:underline">
            Về app user
          </Link>
        </div>
      </div>
    </div>
  );
}
