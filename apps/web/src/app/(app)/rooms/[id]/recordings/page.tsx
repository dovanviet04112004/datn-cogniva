import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { ArrowLeft, PlayCircle } from 'lucide-react';

import { db, room, roomMember } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { getRoomRecordings } from '@/lib/rooms/get-room-recordings';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/layout/empty-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

function fmtDuration(sec: number | null): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export default async function RecordingsPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');
  const { id: roomId } = await params;

  const [member] = await db
    .select()
    .from(roomMember)
    .where(
      and(
        eq(roomMember.roomId, roomId),
        eq(roomMember.userId, session.user.id),
        eq(roomMember.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  if (!member) notFound();

  const [roomRow] = await db
    .select({ name: room.name })
    .from(room)
    .where(eq(room.id, roomId))
    .limit(1);

  const rows = await getRoomRecordings(roomId);

  return (
    <PageShell
      title="Lịch sử ghi hình"
      description={`${roomRow?.name ?? 'Room'} — ${rows.length} buổi đã ghi`}
    >
      <Link
        href={`/rooms/${roomId}`}
        className="text-muted-foreground hover:text-foreground -mt-2 inline-flex items-center gap-1 text-xs"
      >
        <ArrowLeft className="h-3 w-3" />
        Quay lại phòng
      </Link>

      <div className="space-y-2">
        {rows.length === 0 ? (
          <EmptyState
            icon={PlayCircle}
            title="Chưa có buổi học nào được ghi"
            description="Mod có thể bấm nút record khi đang ở trong phòng."
          />
        ) : (
          rows.map((r) => (
            <Link
              key={r.id}
              href={
                r.status === 'RECORDING'
                  ? `/rooms/${roomId}`
                  : `/rooms/${roomId}/recordings/${r.id}`
              }
              className="hover:bg-accent flex items-center gap-3 rounded-md border p-3 transition"
            >
              <PlayCircle className="text-primary h-5 w-5" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {new Date(r.startedAt).toLocaleString('vi-VN')}
                </p>
                {r.summary && (
                  <p className="text-muted-foreground line-clamp-1 text-xs">
                    {r.summary.replace(/[#*]/g, '').slice(0, 120)}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="font-mono text-xs">{fmtDuration(r.duration)}</p>
                <p
                  className={`text-[11px] uppercase ${
                    r.status === 'PROCESSED'
                      ? 'text-success'
                      : r.status === 'PROCESSING' || r.status === 'RECORDING'
                        ? 'text-warning'
                        : 'text-destructive'
                  }`}
                >
                  {r.status}
                </p>
              </div>
            </Link>
          ))
        )}
      </div>
    </PageShell>
  );
}
