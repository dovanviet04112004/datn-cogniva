import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { ThreadList } from '@/components/dm/thread-list';

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/messages');

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="border-divider hidden h-full w-[340px] shrink-0 border-r md:flex">
        <ThreadList />
      </aside>
      <main className="bg-background flex h-full min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
