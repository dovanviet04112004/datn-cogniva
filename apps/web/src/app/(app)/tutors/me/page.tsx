import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServer } from '@/lib/api-server';

export const runtime = 'nodejs';

export default async function TutorMePage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/tutors/me');

  const profile =
    (await apiServer<{ id: string; status: string } | null>('/api/tutoring/my-profile')) ?? null;

  if (!profile) redirect('/tutors/become');
  redirect('/tutoring?tab=mine');
}
