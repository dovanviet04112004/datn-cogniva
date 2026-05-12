/**
 * Client interactive bits cho /coppa-pending page.
 *
 * - Resend email button (rate-limited 3/day backend)
 * - Logout link
 * - Poll status mỗi 30s để auto-redirect khi parent verify
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mail, LogOut } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth-client';

type Props = {
  initialParentEmail: string | null;
};

export function CoppaPendingClient({ initialParentEmail }: Props) {
  const router = useRouter();
  const [resending, setResending] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  // Poll status mỗi 30s — khi parent verify, status đổi VERIFIED → auto redirect
  React.useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/account/parental-consent');
        if (!res.ok) return;
        const data = (await res.json()) as { status: string };
        if (data.status === 'VERIFIED') {
          toast.success('Cha mẹ đã đồng ý! Đang chuyển sang dashboard...');
          setTimeout(() => router.push('/dashboard'), 1500);
        } else if (data.status === 'REJECTED') {
          toast.error('Cha mẹ đã từ chối. Liên hệ support nếu cần khôi phục.');
        }
      } catch {
        // silent — retry next tick
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);

  const resend = async () => {
    setResending(true);
    try {
      const res = await fetch('/api/account/parental-consent', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed');
      }
      toast.success(`Đã gửi lại email cho ${data.parentEmail}`);
      // Dev: show URL cho testing
      if (data.devConsentUrl) {
        console.log('[COPPA dev] Consent URL:', data.devConsentUrl);
        toast.message('Dev mode — check console for consent URL', { duration: 10000 });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setResending(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await signOut({
      fetchOptions: {
        onSuccess: () => router.push('/sign-in'),
      },
    });
  };

  return (
    <div className="mt-6 flex flex-col gap-2">
      <Button onClick={resend} disabled={resending} variant="default">
        {resending ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Mail className="mr-1 h-4 w-4" />
        )}
        Gửi lại email cho {initialParentEmail ?? 'cha mẹ'}
      </Button>
      <Button onClick={handleLogout} disabled={loggingOut} variant="outline" size="sm">
        {loggingOut ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <LogOut className="mr-1 h-4 w-4" />}
        Đăng xuất
      </Button>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Page tự kiểm tra mỗi 30 giây — bạn không cần refresh manual.
      </p>
    </div>
  );
}
