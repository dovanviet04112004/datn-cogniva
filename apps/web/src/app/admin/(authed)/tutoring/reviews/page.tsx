/**
 * /admin/tutoring/reviews — moderation reviews.
 */
import { requireAdmin } from '@/lib/admin/guard';
import { ReviewsListClient } from '@/components/admin/tutoring/reviews-list-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminReviewsPage() {
  const admin = await requireAdmin();
  return <ReviewsListClient adminRole={admin.role} />;
}
