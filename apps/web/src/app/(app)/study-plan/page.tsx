import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServer } from '@/lib/api-server';
import { normalizeItem, type Item } from '@/lib/study-plan/item';

import { StudyPlanClient } from './study-plan-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function StudyPlanPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/study-plan');

  let initialItems: Item[] | undefined;
  try {
    const [todayRes, manualRes] = await Promise.all([
      apiServer<{ items?: unknown[] }>('/api/study-plan/today'),
      apiServer<{ items?: unknown[] }>('/api/study-plan?kind=manual'),
    ]);
    initialItems = [
      ...(todayRes.items ?? []).map(normalizeItem),
      ...(manualRes.items ?? []).map(normalizeItem),
    ];
  } catch (err) {
    console.error('[study-plan] SSR prefetch lỗi, fallback client fetch:', err);
    initialItems = undefined;
  }

  return <StudyPlanClient initialItems={initialItems} />;
}
