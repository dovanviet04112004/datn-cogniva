/**
 * /parental-consent?token=X — public page cho parent click từ email.
 *
 * Plan v2 §3.7.2 COPPA — KHÔNG yêu cầu auth (parent không phải user).
 *
 * Server component:
 *   1. Verify token → load child user info
 *   2. Render confirm/reject form
 *   3. Client submit → /api/parental-consent/respond
 *
 * Error cases:
 *   - Token expired (> 7 day) → "Link đã hết hạn"
 *   - Token invalid → "Link không hợp lệ"
 *   - Already responded → "Đã verify trước đó" (idempotent)
 *   - Child account deleted → 404
 */
import { eq } from 'drizzle-orm';
import Link from 'next/link';

import { db, user } from '@cogniva/db';
import { verifyConsentToken, calculateAge } from '@/lib/coppa';

import { ParentalConsentForm } from './parental-consent-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ token?: string }> };

export default async function ParentalConsentPage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    return <ErrorView title="Thiếu token" message="Link không hợp lệ. Vui lòng dùng URL từ email Cogniva gửi." />;
  }

  // Verify token
  let payload;
  try {
    payload = verifyConsentToken(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invalid';
    const isExpired = /expired|jwt expired/i.test(msg);
    return (
      <ErrorView
        title={isExpired ? 'Link đã hết hạn' : 'Link không hợp lệ'}
        message={
          isExpired
            ? 'Link consent có hiệu lực 7 ngày. Yêu cầu user gửi lại email từ /settings.'
            : 'Token không hợp lệ — có thể đã bị thay đổi hoặc giả mạo.'
        }
      />
    );
  }

  // Load child user
  const [child] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      dateOfBirth: user.dateOfBirth,
      parentalConsentStatus: user.parentalConsentStatus,
      parentEmail: user.parentEmail,
    })
    .from(user)
    .where(eq(user.id, payload.userId))
    .limit(1);

  if (!child) {
    return (
      <ErrorView
        title="Account không tồn tại"
        message="Tài khoản con đã bị xoá. Không cần action thêm."
      />
    );
  }

  // Check status — đã respond trước đó?
  if (child.parentalConsentStatus !== 'PENDING') {
    return (
      <AlreadyRespondedView
        status={child.parentalConsentStatus}
        childEmail={child.email}
      />
    );
  }

  // Defense: parent email trong token phải match DB
  if (child.parentEmail !== payload.parentEmail) {
    return (
      <ErrorView
        title="Link không khớp"
        message="Email trong link không khớp với account. Liên hệ support@cogniva.app."
      />
    );
  }

  const age = child.dateOfBirth ? calculateAge(child.dateOfBirth) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center p-6">
      <div className="w-full rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Xác nhận đồng ý cha mẹ</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Theo luật COPPA (Mỹ) + GDPR Article 8 (EU), Cogniva yêu cầu đồng ý của
          cha mẹ trước khi cho phép user dưới 13 tuổi sử dụng đầy đủ tính năng.
        </p>

        <div className="mt-6 rounded-md border bg-muted/30 p-4 text-sm">
          <p>
            <strong>Tên con:</strong> {child.name ?? '(chưa nhập)'}
          </p>
          <p>
            <strong>Email:</strong> <code className="rounded bg-muted px-1 text-xs">{child.email}</code>
          </p>
          {age !== null && (
            <p>
              <strong>Tuổi:</strong> {age}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Email cha mẹ: <code className="rounded bg-muted px-1 text-xs">{payload.parentEmail}</code>
          </p>
        </div>

        <div className="mt-6 space-y-3 text-sm">
          <h2 className="font-medium">Khi bạn đồng ý, con bạn sẽ được:</h2>
          <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
            <li>Học flashcard với spaced repetition AI-driven</li>
            <li>Upload tài liệu (PDF, hình) để học</li>
            <li>Chat với AI tutor về tài liệu đó</li>
            <li>Tham gia rooms học nhóm với bạn bè</li>
          </ul>

          <h2 className="mt-4 font-medium">Cogniva cam kết:</h2>
          <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
            <li>KHÔNG gửi quảng cáo hoặc marketing email cho user dưới 13</li>
            <li>KHÔNG share data của con cho bên thứ 3 ngoài compliance pháp lý</li>
            <li>Bạn có quyền xem, export, xoá data của con bất cứ lúc nào</li>
            <li>
              Đọc đầy đủ:{' '}
              <Link href="/privacy" className="underline">
                Privacy Policy
              </Link>{' '}
              +{' '}
              <Link href="/coppa" className="underline">
                COPPA Notice
              </Link>
            </li>
          </ul>
        </div>

        <ParentalConsentForm token={token} childName={child.name ?? child.email} />
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Cần hỗ trợ? Email{' '}
        <a href="mailto:support@cogniva.app" className="underline">
          support@cogniva.app
        </a>
      </p>
    </main>
  );
}

function ErrorView({ title, message }: { title: string; message: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6 text-center">
      <h1 className="text-xl font-semibold text-destructive">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <Link
        href="/"
        className="mt-6 rounded-md border px-4 py-2 text-sm hover:bg-muted"
      >
        Về trang chủ
      </Link>
    </main>
  );
}

function AlreadyRespondedView({
  status,
  childEmail,
}: {
  status: string;
  childEmail: string;
}) {
  const verified = status === 'VERIFIED';
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6 text-center">
      <h1 className="text-xl font-semibold">
        {verified ? '✓ Đã đồng ý' : '✗ Đã từ chối'}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Bạn đã {verified ? 'đồng ý' : 'từ chối'} cho account{' '}
        <code className="rounded bg-muted px-1 text-xs">{childEmail}</code> trước
        đó. Quyết định KHÔNG thể đảo ngược qua link này — liên hệ support nếu
        cần thay đổi.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md border px-4 py-2 text-sm hover:bg-muted"
      >
        Về trang chủ
      </Link>
    </main>
  );
}
