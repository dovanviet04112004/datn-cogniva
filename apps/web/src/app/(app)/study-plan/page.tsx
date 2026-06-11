import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { materializeProposalForToday } from '@/lib/study-plan/materialize';
import { getStudyPlanItems } from '@/lib/study-plan/query';
import { normalizeItem, type Item } from '@/lib/study-plan/item';

import { StudyPlanClient } from './study-plan-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function StudyPlanPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/study-plan');
  const userId = session.user.id;

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
