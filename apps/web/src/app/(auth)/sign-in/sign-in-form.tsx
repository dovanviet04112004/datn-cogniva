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

function redirectAfterSignIn(fallback: string) {
  const url = new URL(window.location.href);
  const fresh = url.searchParams.get('redirect') ?? fallback;
  const safe = fresh.startsWith('/') && !fresh.startsWith('//') ? fresh : '/dashboard';
  window.location.replace(safe);
}

const SILENT_REFRESH_KEY = 'cogniva.signin.silent-refresh-tried';

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const [isPending, setIsPending] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    if (sessionStorage.getItem(SILENT_REFRESH_KEY)) return;
    sessionStorage.setItem(SILENT_REFRESH_KEY, '1');
    void (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST' });
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (data?.user && data?.accessToken) {
          sessionStorage.removeItem(SILENT_REFRESH_KEY);
          redirectAfterSignIn(redirectTo);
        }
      } catch {}
    })();
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
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <ShieldCheck className="text-primary h-4 w-4" />
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
                <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
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
