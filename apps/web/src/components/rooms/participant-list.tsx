/**
 * ParticipantList — sidebar liệt kê người trong room + mod actions.
 *
 * Mod (OWNER/MODERATOR) thấy menu 3 chấm cho mỗi participant khác:
 *   - Mute mic
 *   - Promote (chỉ OWNER)
 *   - Kick
 *
 * Dùng `useParticipants()` từ LiveKit React — auto-update khi join/leave.
 */
'use client';

import * as React from 'react';
import { useParticipants } from '@livekit/components-react';
import { Crown, Mic, MicOff, MoreVertical, Shield, UserMinus, UserPlus, Video, VideoOff } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Metadata = { userId?: string; role?: string; avatarUrl?: string | null };

function safeParseMeta(raw: string | undefined): Metadata {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Metadata;
  } catch {
    return {};
  }
}

type Props = {
  roomId: string;
  /** Role của user hiện tại — quyết định hiển thị mod menu. */
  myRole: 'OWNER' | 'MODERATOR' | 'MEMBER';
  /** User id của chính mình — không show mod menu cho bản thân. */
  myUserId: string;
};

export function ParticipantList({ roomId, myRole, myUserId }: Props) {
  const participants = useParticipants();
  const isOwner = myRole === 'OWNER';
  const isMod = isOwner || myRole === 'MODERATOR';

  const callModerate = async (body: Record<string, unknown>, successMsg: string) => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Hành động thất bại');
      }
      toast.success(successMsg);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Đang trong phòng ({participants.length})
      </p>
      {participants.map((p) => {
        const meta = safeParseMeta(p.metadata);
        const name = p.name || p.identity;
        const role = (meta.role ?? 'MEMBER') as 'OWNER' | 'MODERATOR' | 'MEMBER';
        const isSelf = p.identity === myUserId;

        return (
          <div key={p.sid} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
            <Avatar className="h-7 w-7">
              {meta.avatarUrl && <AvatarImage src={meta.avatarUrl} alt={name} />}
              <AvatarFallback className="text-xs">{name[0]?.toUpperCase() ?? '?'}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="truncate text-sm font-medium">{name}{isSelf && ' (bạn)'}</p>
                {role === 'OWNER' && <Crown className="h-3 w-3 text-yellow-500" />}
                {role === 'MODERATOR' && <Shield className="h-3 w-3 text-blue-500" />}
              </div>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              {p.isMicrophoneEnabled
                ? <Mic className="h-3.5 w-3.5" />
                : <MicOff className="h-3.5 w-3.5 text-destructive" />}
              {p.isCameraEnabled
                ? <Video className="h-3.5 w-3.5" />
                : <VideoOff className="h-3.5 w-3.5 text-muted-foreground/50" />}
            </div>

            {/* Mod menu */}
            {isMod && !isSelf && role !== 'OWNER' && (
              <DropdownMenu>
                <DropdownMenuTrigger className="ml-1 rounded-sm p-0.5 hover:bg-muted-foreground/10" aria-label="Mod menu">
                  <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {p.isMicrophoneEnabled && (
                    <DropdownMenuItem
                      onClick={() => callModerate(
                        { action: 'MUTE', targetUserId: p.identity },
                        `Đã mute ${name}`,
                      )}
                    >
                      <MicOff className="mr-2 h-3.5 w-3.5" />
                      Mute mic
                    </DropdownMenuItem>
                  )}
                  {isOwner && role === 'MEMBER' && (
                    <DropdownMenuItem
                      onClick={() => callModerate(
                        { action: 'PROMOTE', targetUserId: p.identity },
                        `Đã promote ${name} thành mod`,
                      )}
                    >
                      <UserPlus className="mr-2 h-3.5 w-3.5" />
                      Promote moderator
                    </DropdownMenuItem>
                  )}
                  {isOwner && role === 'MODERATOR' && (
                    <DropdownMenuItem
                      onClick={() => callModerate(
                        { action: 'DEMOTE', targetUserId: p.identity },
                        `Đã hạ ${name} xuống member`,
                      )}
                    >
                      <UserMinus className="mr-2 h-3.5 w-3.5" />
                      Demote
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => {
                      if (!confirm(`Kick ${name} khỏi phòng?`)) return;
                      callModerate(
                        { action: 'KICK', targetUserId: p.identity },
                        `Đã kick ${name}`,
                      );
                    }}
                  >
                    <UserMinus className="mr-2 h-3.5 w-3.5" />
                    Kick khỏi phòng
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}
    </div>
  );
}
