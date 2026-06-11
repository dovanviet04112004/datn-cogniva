import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db, tutorProfile } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';

export const runtime = 'nodejs';

export default async function TutorMePage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/tutors/me');

  const [profile] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);

  if (!profile) redirect('/tutors/become');
  redirect('/tutoring?tab=mine');
}
