import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';
import { Button } from '@/components/ui/button';
import { LobbyForm } from '@/components/rooms/lobby-form';
import { RoomShareCode } from '@/components/rooms/room-share-code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function LobbyPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect(`/sign-in?redirect=/rooms`);
  const { id } = await params;

  const res = await apiServerOrNull<{
    room: { id: string; name: string; joinCode: string | null };
  }>(`/api/rooms/${id}`);
  if (!res) notFound();
  const target = res.room;

  return (
    <div className="container max-w-5xl space-y-6 py-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild aria-label="Quay lại">
          <Link href="/rooms">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Sảnh chờ</h1>
      </div>

      <LobbyForm
        roomId={target.id}
        roomName={target.name}
        defaultDisplayName={session.user.name ?? session.user.email}
      />

      {target.joinCode && <RoomShareCode roomId={target.id} joinCode={target.joinCode} />}
    </div>
  );
}
