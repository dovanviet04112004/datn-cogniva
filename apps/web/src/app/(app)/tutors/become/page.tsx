import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db, tutorProfile } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { BecomeTutorWizard } from '@/components/tutoring/become-tutor-wizard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function BecomeTutorPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/tutors/become');

  const [existing] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);
  if (existing) redirect(`/tutors/${existing.id}`);

  return <BecomeTutorWizard />;
}
