import { redirect } from 'next/navigation';
import { CalendarDays } from 'lucide-react';

import { getServerSession } from '@/lib/auth-server';
import { PageShell } from '@/components/layout/page-shell';
import { CalendarClient } from '@/components/tutoring/calendar/calendar-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/tutoring/calendar');
  return (
    <PageShell
      size="wide"
      padded
      className="space-y-4"
      eyebrowIcon={CalendarDays}
      title="Lịch học"
      description="Toàn bộ buổi học + lớp nhóm + blocked time. Drag-drop để đổi lịch."
    >
      <CalendarClient />
    </PageShell>
  );
}
