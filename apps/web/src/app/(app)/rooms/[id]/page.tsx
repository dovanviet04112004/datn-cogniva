import { notFound, redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';
import { RoomClient } from '@/components/rooms/room-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function RoomPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/rooms');
  const { id } = await params;

  const res = await apiServerOrNull<{ room: { id: string; name: string } }>(`/api/rooms/${id}`);
  if (!res) notFound();

  return (
    <div className="h-[calc(100vh-3.5rem)] w-full">
      <RoomClient
        roomId={res.room.id}
        roomName={res.room.name}
        currentUserId={session.user.id}
        currentUserName={session.user.name ?? session.user.email}
      />
    </div>
  );
}
