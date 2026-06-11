import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { NewRequestForm } from '@/components/tutoring/new-request-form';

export const runtime = 'nodejs';

export default async function NewRequestPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/tutoring/requests/new');

  return <NewRequestForm />;
}
