/**
 * /tutors/become — wizard 3-step để user upgrade thành tutor.
 *
 * Step 1: Bio (headline + description + rate + modality)
 * Step 2: Subjects (pick từ taxonomy)
 * Step 3: Availability (weekly matrix)
 * Done: review + publish (DRAFT → PUBLISHED qua /api/tutors/[id]/publish)
 *
 * State management: lưu các step trong localStorage để user khỏi mất dữ liệu
 * nếu reload. Sau khi tạo profile (API call), lấy id để gắn subject + slot.
 */
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

  // Check user đã có profile chưa — nếu có thì gửi tới /tutors/me thay vì lặp
  const [existing] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);
  if (existing) redirect(`/tutors/${existing.id}`);

  return <BecomeTutorWizard />;
}
