/**
 * /rooms/[id]/lobby — pre-join screen.
 *
 * Server component: fetch room info (verify exists + user có thể access).
 * Render LobbyForm client component cho cam preview + form.
 *
 * Share section: hiển thị joinCode 6 ký tự + nút copy link để mời người khác.
 */
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { eq } from 'drizzle-orm';

import { db, room } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { LobbyForm } from '@/components/rooms/lobby-form';
import { RoomShareCode } from '@/components/rooms/room-share-code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function LobbyPage({ params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?redirect=/rooms`);
  const { id } = await params;

  const [target] = await db.select().from(room).where(eq(room.id, id)).limit(1);
  if (!target) notFound();

  return (
    <div className="container max-w-5xl space-y-6 py-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild aria-label="Quay lại">
          <Link href="/rooms"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-lg font-semibold">Sảnh chờ</h1>
      </div>

      <LobbyForm
        roomId={target.id}
        roomName={target.name}
        defaultDisplayName={session.user.name ?? session.user.email}
      />

      {target.joinCode && (
        <RoomShareCode roomId={target.id} joinCode={target.joinCode} />
      )}
    </div>
  );
}
