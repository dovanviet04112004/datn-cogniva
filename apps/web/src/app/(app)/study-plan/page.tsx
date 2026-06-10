/**
 * /study-plan — Server Component (Phase B atom-centric).
 *
 * Prefetch initial data server-side (proposal hôm nay + manual items) rồi truyền
 * xuống <StudyPlanClient> làm initialData → first paint có data ngay, không
 * skeleton client-side. Toàn bộ tương tác (toggle/skip/delete + dialog) ở client.
 *
 * Routes /api/study-plan/today, /api/study-plan, /api/study-plan/{id} GIỮ NGUYÊN
 * (mobile vẫn gọi); query dùng chung lib materialize + getStudyPlanItems.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { materializeProposalForToday } from '@/lib/study-plan/materialize';
import { getStudyPlanItems } from '@/lib/study-plan/query';
import { normalizeItem, type Item } from '@/lib/study-plan/item';

import { StudyPlanClient } from './study-plan-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function StudyPlanPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?redirect=/study-plan');
  const userId = session.user.id;

  // Prefetch song song y như client queryFn: proposal hôm nay (materialize
  // idempotent) + manual items. JSON round-trip để Date→ISO giống hệt khi đi
  // qua network, rồi normalize cho ra initialItems khớp tuyệt đối shape useQuery
  // (today trước, manual sau).
  //
  // Bọc try/catch: prefetch chỉ là tối ưu first-paint — nếu lỗi thì KHÔNG được
  // crash cả trang. Fallback initialItems=undefined → client island tự fetch
  // qua API (degrade đúng như hành vi client cũ, có skeleton).
  let initialItems: Item[] | undefined;
  try {
    const [todayRows, manualRows] = await Promise.all([
      materializeProposalForToday(userId),
      getStudyPlanItems(userId, { kind: 'manual' }),
    ]);
    const serialized = JSON.parse(JSON.stringify({ todayRows, manualRows })) as {
      todayRows: unknown[];
      manualRows: unknown[];
    };
    initialItems = [
      ...serialized.todayRows.map(normalizeItem),
      ...serialized.manualRows.map(normalizeItem),
    ];
  } catch (err) {
    console.error('[study-plan] SSR prefetch lỗi, fallback client fetch:', err);
    initialItems = undefined;
  }

  return <StudyPlanClient initialItems={initialItems} />;
}
