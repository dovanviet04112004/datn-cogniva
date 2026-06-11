/**
 * /join — server-side resolve code → redirect.
 *
 * Flow:
 *   - Chưa login → redirect /auth/sign-in?redirect=/join?code=XXX
 *     (sau khi login Better Auth bounce về URL này, code auto resolve tiếp)
 *   - Có session + code trong URL → lookup exam → redirect /exams/[id]
 *   - Có session, không có code → render form nhập tay (client component)
 *
 * Mục tiêu UX: click share link `https://x.com/join?code=2VEWVM`
 *   - Nếu đã login: nhảy thẳng vào /exams/[id], không qua màn nhập code
 *   - Nếu chưa login: nhảy sang sign-in, sau login auto continue đến exam
 */
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db, exam } from '@cogniva/db';
import { getServerSession } from '@/lib/auth-server';

import { JoinForm } from './join-form';

export const runtime = 'nodejs';

type Props = {
  searchParams: Promise<{ code?: string }>;
};

export default async function JoinExamPage({ searchParams }: Props) {
  const { code } = await searchParams;
  const cleanedCode = code?.trim().toUpperCase();

  const session = await getServerSession();

  // Chưa login → redirect sign-in giữ lại code qua returnTo.
  // Route group `(auth)` không vào URL → path thực là `/sign-in`.
  if (!session) {
    const returnTo = cleanedCode ? `/join?code=${cleanedCode}` : '/join';
    redirect(`/sign-in?redirect=${encodeURIComponent(returnTo)}`);
  }

  // Có code trong URL → resolve server-side + redirect ngay
  if (cleanedCode && cleanedCode.length >= 4 && cleanedCode.length <= 12) {
    const [row] = await db
      .select({ id: exam.id, status: exam.status })
      .from(exam)
      .where(eq(exam.liveCode, cleanedCode))
      .limit(1);
    if (row && row.status === 'PUBLISHED') {
      redirect(`/exams/${row.id}`);
    }
    // Code không hợp lệ → fall through render form với error inline
    return <JoinForm initialCode={cleanedCode} error="Không tìm thấy exam với code này (hoặc chưa publish)" />;
  }

  // Không có code → form nhập tay
  return <JoinForm initialCode="" />;
}
