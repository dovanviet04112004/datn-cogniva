/**
 * Form sign-in — gọi API auth V2 (NestJS JWT).
 *
 * Luồng:
 *  1. email + password → POST /api/auth/sign-in (lib/auth-api).
 *  2. User bật 2FA → server trả challengeToken → form chuyển bước nhập mã
 *     TOTP 6 số → POST /api/auth/sign-in/2fa.
 *  3. Thành công: server đã set cookie cg_at/cg_rt → full reload về
 *     redirectTo để SSR nhận session.
 *
 * Silent refresh: cg_at chỉ sống 15' (cg_rt scope /api/auth nên SSR không
 * thấy) — user idle quay lại bị middleware đá về đây dù còn refresh token.
 * Khi mount thử POST /api/auth/refresh đúng 1 LẦN (sessionStorage chống
 * loop; KHÔNG auto-refresh ở middleware vì rotation + reuse-detection sẽ
 * revoke family khi nhiều request đua nhau) — thành công thì quay lại luôn,
 * user không phải gõ mật khẩu.
 */
'use client';

import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { signIn, signInTwoFactor } from '@/lib/auth-api';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

type FormValues = z.infer<typeof schema>;

/** Điều hướng sau đăng nhập — đọc redirect fresh từ URL, chặn open-redirect. */
function redirectAfterSignIn(fallback: string) {
  const url = new URL(window.location.href);
  const fresh = url.searchParams.get('redirect') ?? fallback;
  const safe = fresh.startsWith('/') && !fresh.startsWith('//') ? fresh : '/dashboard';
  // Full reload + không thêm /sign-in vào history (back không quay lại form).
  window.location.replace(safe);
}

const SILENT_REFRESH_KEY = 'cogniva.signin.silent-refresh-tried';

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const [isPending, setIsPending] = useState(false);
  // Khác null = đang ở bước 2 (nhập mã TOTP).
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    if (sessionStorage.getItem(SILENT_REFRESH_KEY)) return;
    sessionStorage.setItem(SILENT_REFRESH_KEY, '1');
    void fetch('/api/auth/refresh', { method: 'POST' }).then((res) => {
      if (res.ok) {
        sessionStorage.removeItem(SILENT_REFRESH_KEY);
        redirectAfterSignIn(redirectTo);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setIsPending(true);
    const result = await signIn(values.email, values.password);
    if (!result.ok) {
      setIsPending(false);
      toast.error(result.error);
      return;
    }
    if (result.twoFactorRequired) {
      setIsPending(false);
      setChallengeToken(result.challengeToken);
      return;
    }
    redirectAfterSignIn(redirectTo);
  };

  const onSubmitCode = async () => {
    if (!challengeToken || code.length !== 6) return;
    setIsPending(true);
    const result = await signInTwoFactor(challengeToken, code);
    if (!result.ok) {
      setIsPending(false);
      toast.error(result.error);
      return;
    }
    redirectAfterSignIn(redirectTo);
  };

  if (challengeToken) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Nhập mã 6 số từ ứng dụng xác thực của bạn.
        </div>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && onSubmitCode()}
          autoFocus
        />
        <Button className="w-full" disabled={isPending || code.length !== 6} onClick={onSubmitCode}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Xác nhận
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          disabled={isPending}
          onClick={() => {
            setChallengeToken(null);
            setCode('');
          }}
        >
          Quay lại
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </Button>
      </form>
    </Form>
  );
}
