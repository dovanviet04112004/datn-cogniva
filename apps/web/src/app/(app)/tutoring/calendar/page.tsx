/**
 * /tutoring/calendar — V4 T4 (2026-05-22).
 *
 * Calendar week/month view cho user (tutor + student unified).
 *
 * Spec: docs/plans/tutoring-v4.md §7.7.
 */
import { redirect } from 'next/navigation';
import { CalendarDays } from 'lucide-react';

import { getServerSession } from '@/lib/auth-server';
import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { CalendarClient } from '@/components/tutoring/calendar/calendar-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/tutoring/calendar');
  return (
    <PageShell size="wide" padded className="space-y-4">
      {/* Hero CHUNG thay header tự-chế — h1 → title, p → description. */}
      <PageHero
        eyebrow="Lịch học"
        eyebrowIcon={CalendarDays}
        title="Lịch học"
        description="Toàn bộ buổi học + lớp nhóm + blocked time. Drag-drop để đổi lịch."
      />
      <CalendarClient />
    </PageShell>
  );
}
