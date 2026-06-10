/**
 * /tutors/me — gom về hub cá nhân duy nhất.
 *
 * Trước đây có dashboard riêng → trùng với tab "Tổng quan" (/tutoring?tab=mine)
 * vốn đã hiển thị hồ sơ + đơn + thu nhập + applications. Để khỏi 2 nơi lặp
 * chức năng, route này chỉ redirect về tab Tổng quan. Chưa có profile thì sang
 * /tutors/become.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db, tutorProfile } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export default async function TutorMePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?redirect=/tutors/me');

  const [profile] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);

  if (!profile) redirect('/tutors/become');
  redirect('/tutoring?tab=mine');
}
