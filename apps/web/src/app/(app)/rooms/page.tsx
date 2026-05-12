/**
 * /rooms — list rooms của user + tạo room mới + join by code.
 *
 * 2 nhóm hiển thị:
 *   - "Phòng của bạn"   (mine) — user là owner
 *   - "Đã tham gia"     (joined) — là member/mod, không phải owner
 *
 * Bên phải có: nút "Tạo phòng" + input "Join by code".
 *
 * Server component: fetch trực tiếp qua Drizzle (không qua API route) để
 * SSR nhanh, type-safe.
 */
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { Calendar, Lock, MessageSquare, Users, Video } from 'lucide-react';

import { db, room, roomMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CreateRoomDialog } from '@/components/rooms/create-room-dialog';
import { JoinByCode } from '@/components/rooms/join-by-code';
import { formatRelativeTime } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function RoomsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?redirect=/rooms');
  const uid = session.user.id;

  const mine = await db
    .select({
      id: room.id,
      name: room.name,
      description: room.description,
      visibility: room.visibility,
      status: room.status,
      joinCode: room.joinCode,
      createdAt: room.createdAt,
      memberCount: sql<number>`(SELECT count(*)::int FROM "room_member" WHERE room_id = ${room.id} AND status = 'ACTIVE')`,
    })
    .from(room)
    .where(eq(room.ownerId, uid))
    .orderBy(desc(room.createdAt))
    .limit(50);

  const joined = await db
    .select({
      id: room.id,
      name: room.name,
      description: room.description,
      visibility: room.visibility,
      status: room.status,
      role: roomMember.role,
      createdAt: room.createdAt,
      memberCount: sql<number>`(SELECT count(*)::int FROM "room_member" WHERE room_id = ${room.id} AND status = 'ACTIVE')`,
    })
    .from(roomMember)
    .innerJoin(room, eq(roomMember.roomId, room.id))
    .where(
      and(
        eq(roomMember.userId, uid),
        eq(roomMember.status, 'ACTIVE'),
        ne(room.ownerId, uid),
      ),
    )
    .orderBy(desc(room.createdAt))
    .limit(50);

  return (
    <div className="container max-w-5xl space-y-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Phòng học</h1>
          <p className="text-sm text-muted-foreground">
            Video call + chia sẻ màn hình + chat — học nhóm realtime.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="w-56"><JoinByCode /></div>
          <CreateRoomDialog />
        </div>
      </div>

      {/* ── Mine ──────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Phòng của bạn ({mine.length})
        </h2>
        {mine.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">Chưa có phòng nào</CardTitle>
              <CardDescription>
                Tạo phòng đầu tiên ở nút trên, share code 6 ký tự cho bạn bè để cùng học.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {mine.map((r) => (
              <RoomCard key={r.id} room={r} owner />
            ))}
          </div>
        )}
      </section>

      {/* ── Joined ────────────────────────── */}
      {joined.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Đã tham gia ({joined.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {joined.map((r) => (
              <RoomCard key={r.id} room={r as any} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

type RoomCardProps = {
  room: {
    id: string;
    name: string;
    description: string | null;
    visibility: 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
    status: 'IDLE' | 'ACTIVE' | 'ENDED';
    joinCode?: string | null;
    role?: 'OWNER' | 'MODERATOR' | 'MEMBER';
    createdAt: Date;
    memberCount: number;
  };
  owner?: boolean;
};

function RoomCard({ room, owner }: RoomCardProps) {
  const statusBadge = {
    IDLE: { label: 'Trống', variant: 'outline' as const },
    ACTIVE: { label: 'Đang diễn ra', variant: 'default' as const },
    ENDED: { label: 'Đã kết thúc', variant: 'secondary' as const },
  }[room.status];

  return (
    <Link href={`/rooms/${room.id}/lobby`} className="block">
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/30">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base">{room.name}</CardTitle>
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>
          {room.description && (
            <CardDescription className="line-clamp-2">{room.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex items-center gap-3 pt-0 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {room.memberCount}
          </span>
          <span className="flex items-center gap-1">
            {room.visibility === 'PRIVATE' ? <Lock className="h-3 w-3" /> : <Video className="h-3 w-3" />}
            {room.visibility === 'PRIVATE' ? 'Riêng tư' : room.visibility === 'PUBLIC' ? 'Công khai' : 'Có link'}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatRelativeTime(room.createdAt)}
          </span>
          {owner && room.joinCode && (
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase">
              {room.joinCode}
            </span>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

// Silence unused imports lint
void MessageSquare;
