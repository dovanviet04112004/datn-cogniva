import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db, room } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { RoomClient } from '@/components/rooms/room-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function RoomPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/rooms');
  const { id } = await params;

  const [target] = await db.select().from(room).where(eq(room.id, id)).limit(1);
  if (!target) notFound();

  return (
    <div className="h-[calc(100vh-3.5rem)] w-full">
      <RoomClient
        roomId={target.id}
        roomName={target.name}
        currentUserId={session.user.id}
        currentUserName={session.user.name ?? session.user.email}
      />
    </div>
  );
}
