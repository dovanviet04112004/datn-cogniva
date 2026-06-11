/**
 * Layout cho /messages — 2-pane Messenger pattern.
 *
 * Desktop (md+):
 *   - Left aside w-[340px]: ThreadList luôn visible
 *   - Right main: children (chat hoặc empty splash)
 *
 * Mobile (< md):
 *   - Aside hidden (ThreadList render full-screen ở /messages page)
 *   - Main full width — chat ở /messages/[id] hoặc list ở /messages
 *
 * Auth check ở đây để các sub-route khỏi lặp lại.
 */
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { ThreadList } from '@/components/dm/thread-list';

export default async function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/messages');

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: thread list (desktop only) */}
      <aside className="hidden h-full w-[340px] shrink-0 border-r border-divider md:flex">
        <ThreadList />
      </aside>
      {/* Right: chat hoặc splash */}
      <main className="flex h-full min-w-0 flex-1 flex-col bg-background">
        {children}
      </main>
    </div>
  );
}
