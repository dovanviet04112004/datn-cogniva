import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServer } from '@/lib/api-server';
import { BecomeTutorWizard } from '@/components/tutoring/become-tutor-wizard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function BecomeTutorPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/tutors/become');

  const existing =
    (await apiServer<{ id: string; status: string } | null>('/api/tutoring/my-profile')) ?? null;
  if (existing) redirect(`/tutors/${existing.id}`);

  return <BecomeTutorWizard />;
}
