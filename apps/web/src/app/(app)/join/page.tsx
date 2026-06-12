import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServer } from '@/lib/api-server';

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
    const result = await apiServer<{ id: string | null }>(
      `/api/exams/lookup?code=${encodeURIComponent(cleanedCode)}`,
    );
    if (result.id) {
      redirect(`/exams/${result.id}`);
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
