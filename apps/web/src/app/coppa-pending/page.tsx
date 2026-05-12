/**
 * /coppa-pending — informational page sau khi user < 13 signup.
 *
 * Show:
 *   - Thông báo email đã gửi tới parent
 *   - Hướng dẫn parent check spam folder
 *   - Resend button (rate-limited 3/day)
 *   - Tài khoản limited cho tới khi parent verify
 *
 * KHÔNG yêu cầu auth — show ngay sau signup, user vừa login.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { getUserConsentState } from '@/lib/coppa';

import { CoppaPendingClient } from './coppa-pending-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function CoppaPendingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const state = await getUserConsentState(session.user.id);
  if (!state || state.status !== 'PENDING') {
    // Đã verified hoặc không cần consent — về dashboard
    redirect('/dashboard');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-6 text-center">
      <div className="w-full rounded-lg border bg-card p-6 shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
          <svg
            className="h-6 w-6 text-amber-600 dark:text-amber-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>

        <h1 className="text-xl font-semibold">Đang đợi cha mẹ xác nhận</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Cogniva đã gửi email tới{' '}
          <strong className="text-foreground">{state.parentEmail}</strong>
          <br />
          để xin đồng ý theo luật COPPA.
        </p>

        <div className="mt-6 rounded-md bg-muted/30 p-4 text-left text-sm">
          <p className="font-medium">Trong khi đợi:</p>
          <ul className="ml-5 mt-2 list-disc space-y-1 text-muted-foreground">
            <li>Account của bạn đã được tạo nhưng <strong>limited</strong></li>
            <li>KHÔNG dùng được AI, upload tài liệu, hoặc tham gia rooms</li>
            <li>Dùng được: xem profile, đổi cài đặt, logout</li>
            <li>Sau khi cha mẹ đồng ý → account unlock đầy đủ</li>
          </ul>
        </div>

        <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-50 p-4 text-left text-sm dark:bg-amber-950/20">
          <p className="font-medium">Mẹo nói với cha mẹ:</p>
          <p className="mt-1 text-xs text-muted-foreground">
            &ldquo;Mẹ ơi, con đăng ký Cogniva để học. Mẹ check email của mẹ và click
            vào nút <em>Đồng ý</em> nha. Mẹ có 7 ngày để click.&rdquo;
          </p>
        </div>

        <CoppaPendingClient initialParentEmail={state.parentEmail} />
      </div>
    </main>
  );
}
