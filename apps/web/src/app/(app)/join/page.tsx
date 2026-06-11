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

  if (!session) {
    const returnTo = cleanedCode ? `/join?code=${cleanedCode}` : '/join';
    redirect(`/sign-in?redirect=${encodeURIComponent(returnTo)}`);
  }

  if (cleanedCode && cleanedCode.length >= 4 && cleanedCode.length <= 12) {
    const [row] = await db
      .select({ id: exam.id, status: exam.status })
      .from(exam)
      .where(eq(exam.liveCode, cleanedCode))
      .limit(1);
    if (row && row.status === 'PUBLISHED') {
      redirect(`/exams/${row.id}`);
    }
    return (
      <JoinForm
        initialCode={cleanedCode}
        error="Không tìm thấy exam với code này (hoặc chưa publish)"
      />
    );
  }

  return <JoinForm initialCode="" />;
}
