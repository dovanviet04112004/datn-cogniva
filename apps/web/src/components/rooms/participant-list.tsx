'use client';

import * as React from 'react';
import { useParticipants } from '@livekit/components-react';
import {
  Crown,
  Mic,
  MicOff,
  MoreVertical,
  Shield,
  UserMinus,
  UserPlus,
  Video,
  VideoOff,
} from 'lucide-react';
import { toast } from 'sonner';

import { apiSend } from '@cogniva/shared/api';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/use-confirm';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SectionHeading } from '@/components/ui/section-heading';
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
  myRole: 'OWNER' | 'MODERATOR' | 'MEMBER';
  myUserId: string;
};

export function ParticipantList({ roomId, myRole, myUserId }: Props) {
  const participants = useParticipants();
  const confirm = useConfirm();
  const isOwner = myRole === 'OWNER';
  const isMod = isOwner || myRole === 'MODERATOR';

  const callModerate = async (body: Record<string, unknown>, successMsg: string) => {
    try {
      await apiSend(`/api/rooms/${roomId}/moderate`, 'POST', body);
      toast.success(successMsg);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-1 p-3">
      <SectionHeading count={participants.length} className="mb-2 px-2">
        Đang trong phòng
      </SectionHeading>
      {participants.map((p) => {
        const meta = safeParseMeta(p.metadata);
        const name = p.name || p.identity;
        const role = (meta.role ?? 'MEMBER') as 'OWNER' | 'MODERATOR' | 'MEMBER';
        const isSelf = p.identity === myUserId;
        const isSpeaking = p.isSpeaking;

        return (
          <div
            key={p.sid}
            className={cn(
              'group/p flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors',
              'hover:bg-muted/60',
              isSpeaking && 'bg-primary/8 ring-primary/30 ring-1',
            )}
          >
            <div className="relative shrink-0">
              <Avatar
                className={cn(
                  'duration-base h-8 w-8 transition-all',
                  isSpeaking && 'ring-primary ring-offset-background ring-2 ring-offset-2',
                )}
              >
                {meta.avatarUrl && <AvatarImage src={meta.avatarUrl} alt={name} />}
                <AvatarFallback className="text-xs">{name[0]?.toUpperCase() ?? '?'}</AvatarFallback>
              </Avatar>
              {isSpeaking && (
                <span
                  aria-hidden
                  className="bg-primary/20 animate-soft-pulse absolute -inset-1 rounded-full blur-md"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-medium tracking-tight">
                  {name}
                  {isSelf && (
                    <span className="text-text-muted ml-1 text-xs font-normal">(bạn)</span>
                  )}
                </p>
                {role === 'OWNER' && <Crown className="h-3 w-3 shrink-0 text-yellow-500" />}
                {role === 'MODERATOR' && <Shield className="h-3 w-3 shrink-0 text-blue-500" />}
              </div>
              {isSpeaking && (
                <p className="text-primary animate-soft-pulse text-[10px] font-medium uppercase tracking-[0.14em]">
                  đang nói
                </p>
              )}
            </div>
            <div className="text-muted-foreground flex items-center gap-1">
              {p.isMicrophoneEnabled ? (
                <Mic className="text-foreground/60 h-3.5 w-3.5" />
              ) : (
                <MicOff className="text-destructive h-3.5 w-3.5" />
              )}
              {p.isCameraEnabled ? (
                <Video className="text-foreground/60 h-3.5 w-3.5" />
              ) : (
                <VideoOff className="text-muted-foreground/40 h-3.5 w-3.5" />
              )}
            </div>

            {isMod && !isSelf && role !== 'OWNER' && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="hover:bg-muted-foreground/10 ml-1 rounded-sm p-0.5"
                  aria-label="Mod menu"
                >
                  <MoreVertical className="text-muted-foreground h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {p.isMicrophoneEnabled && (
                    <DropdownMenuItem
                      onClick={() =>
                        callModerate(
                          { action: 'MUTE', targetUserId: p.identity },
                          `Đã mute ${name}`,
                        )
                      }
                    >
                      <MicOff className="mr-2 h-3.5 w-3.5" />
                      Mute mic
                    </DropdownMenuItem>
                  )}
                  {isOwner && role === 'MEMBER' && (
                    <DropdownMenuItem
                      onClick={() =>
                        callModerate(
                          { action: 'PROMOTE', targetUserId: p.identity },
                          `Đã promote ${name} thành mod`,
                        )
                      }
                    >
                      <UserPlus className="mr-2 h-3.5 w-3.5" />
                      Promote moderator
                    </DropdownMenuItem>
                  )}
                  {isOwner && role === 'MODERATOR' && (
                    <DropdownMenuItem
                      onClick={() =>
                        callModerate(
                          { action: 'DEMOTE', targetUserId: p.identity },
                          `Đã hạ ${name} xuống member`,
                        )
                      }
                    >
                      <UserMinus className="mr-2 h-3.5 w-3.5" />
                      Demote
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Kick ${name} khỏi phòng?`,
                        confirmLabel: 'Kick',
                        variant: 'destructive',
                      });
                      if (!ok) return;
                      callModerate({ action: 'KICK', targetUserId: p.identity }, `Đã kick ${name}`);
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
