/**
 * /rooms/[id]/recordings — Lịch sử recording của 1 room.
 *
 * Server component: list rows recording + link sang [recId].
 * Quyền: member ACTIVE only (cùng pattern với replay page).
 */
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { ArrowLeft, PlayCircle } from 'lucide-react';

import { db, recording, room, roomMember } from '@cogniva/db';

import { auth } from '@/lib/auth';

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
  const session = await auth.api.getSession({ headers: await headers() });
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

  const rows = await db
    .select({
      id: recording.id,
      status: recording.status,
      duration: recording.duration,
      summary: recording.summary,
      startedAt: recording.startedAt,
    })
    .from(recording)
    .where(eq(recording.roomId, roomId))
    .orderBy(desc(recording.startedAt))
    .limit(50);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link
        href={`/rooms/${roomId}`}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Quay lại phòng
      </Link>
      <h1 className="text-2xl font-semibold">Lịch sử ghi hình</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {roomRow?.name ?? 'Room'} — {rows.length} buổi đã ghi
      </p>

      <div className="mt-6 space-y-2">
        {rows.length === 0 ? (
          <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
            Chưa có buổi học nào được ghi. Mod có thể bấm nút record khi đang ở trong phòng.
          </p>
        ) : (
          rows.map((r) => (
            <Link
              key={r.id}
              href={
                r.status === 'RECORDING'
                  ? `/rooms/${roomId}`
                  : `/rooms/${roomId}/recordings/${r.id}`
              }
              className="flex items-center gap-3 rounded-md border p-3 transition hover:bg-accent"
            >
              <PlayCircle className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {new Date(r.startedAt).toLocaleString('vi-VN')}
                </p>
                {r.summary && (
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {r.summary.replace(/[#*]/g, '').slice(0, 120)}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs font-mono">{fmtDuration(r.duration)}</p>
                <p
                  className={`text-[10px] uppercase ${
                    r.status === 'PROCESSED'
                      ? 'text-green-600'
                      : r.status === 'PROCESSING' || r.status === 'RECORDING'
                        ? 'text-amber-600'
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
    </div>
  );
}
