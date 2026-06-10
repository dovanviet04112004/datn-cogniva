/**
 * VoiceChannelMembers — list nhỏ render NGAY DƯỚI tên VOICE channel trong
 * sidebar trái (channel list). Discord-style nested participants.
 *
 * Khác với `VoiceParticipantList` (full sidebar bên phải): cái này compact,
 * chỉ hiển thị avatar 20px + tên truncate + mic-off icon. Click vào để vào
 * voice channel.
 *
 * Data flow:
 *   1. Initial: GET /api/channels/[id]/voice/participants
 *   2. Subscribe realtime (Socket.IO) `presence-voice-{channelId}`:
 *      - 'voice:join'  { userId, name, image, ... } → merge thẳng (KHỎI refetch).
 *        Payload tối thiểu (webhook prod, thiếu name) → fallback refetch.
 *      - 'voice:leave' { userId } → drop user khỏi list.
 *
 * Merge thẳng từ payload thay vì refetch → giảm 1 vòng HTTP, người vô voice
 * hiện nhanh hơn.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Mic, MicOff, ScreenShare, Video } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useRealtimeEvent } from '@/lib/realtime-client';
import {
  VOICE_STATE_EVENT,
  type VoiceStateEventDetail,
} from './voice-state-sync';

type Participant = {
  userId: string;
  name: string | null;
  image: string | null;
  selfMuted: boolean;
  serverMuted: boolean;
  camera: boolean;
  screenShare: boolean;
  joinedAt: string;
};

/**
 * Local presence event — VoiceSessionProvider bắn khi CHÍNH user vô/rời voice.
 * Cho own user hiện/biến NGAY 0ms trong sidebar, không chờ roundtrip realtime
 * (kiểu Discord optimistic). Người KHÁC vô/rời vẫn qua realtime `voice:join/leave`.
 */
export const VOICE_PRESENCE_EVENT = 'cogniva:voice-presence';
export type VoicePresenceEventDetail = {
  channelId: string;
  action: 'join' | 'leave';
  user: { userId: string; name: string | null; image: string | null };
};

export function VoiceChannelMembers({
  groupId,
  channelId,
  currentUserId,
}: {
  groupId: string;
  channelId: string;
  currentUserId: string;
}) {
  const [participants, setParticipants] = React.useState<Participant[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${channelId}/voice/participants`);
      if (!res.ok) return;
      const data = (await res.json()) as { participants: Participant[] };
      setParticipants(data.participants);
    } catch {
      /* ignore — list không critical */
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  // Initial load
  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  // Helper merge state vào 1 user trong list — share giữa local + realtime path
  const mergeState = React.useCallback(
    (data: { userId: string; selfMuted?: boolean; camera?: boolean; screenShare?: boolean }) => {
      setParticipants((prev) =>
        prev.map((p) => {
          if (p.userId !== data.userId) return p;
          return {
            ...p,
            selfMuted: data.selfMuted ?? p.selfMuted,
            camera: data.camera ?? p.camera,
            screenShare: data.screenShare ?? p.screenShare,
          };
        }),
      );
    },
    [],
  );

  // ── Path 0: optimistic presence — own user vô/rời HIỆN NGAY 0ms ──
  React.useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<VoicePresenceEventDetail>).detail;
      if (!d || d.channelId !== channelId) return;
      if (d.action === 'leave') {
        setParticipants((prev) => prev.filter((p) => p.userId !== d.user.userId));
        return;
      }
      setParticipants((prev) =>
        prev.some((p) => p.userId === d.user.userId)
          ? prev
          : [
              ...prev,
              {
                userId: d.user.userId,
                name: d.user.name,
                image: d.user.image,
                selfMuted: true, // vào phòng mic TẮT
                serverMuted: false,
                camera: false,
                screenShare: false,
                joinedAt: new Date().toISOString(),
              },
            ],
      );
    };
    window.addEventListener(VOICE_PRESENCE_EVENT, handler);
    return () => window.removeEventListener(VOICE_PRESENCE_EVENT, handler);
  }, [channelId]);

  // ── Path 1: local window event — 0ms cho own user trong cùng tab ──
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<VoiceStateEventDetail>).detail;
      if (!detail || detail.channelId !== channelId) return;
      mergeState(detail);
    };
    window.addEventListener(VOICE_STATE_EVENT, handler);
    return () => window.removeEventListener(VOICE_STATE_EVENT, handler);
  }, [channelId, mergeState]);

  // ── Path 2: realtime — CHỈ cho remote users (tab khác / user khác) ──
  // BỎ QUA echo của CHÍNH MÌNH (data.userId === currentUserId): own user đã được cập nhật
  // TỨC THÌ + đúng thứ tự qua window event (Path 0/1). Realtime echo của chính mình về trễ
  // + có thể sai thứ tự khi toggle nhanh → ghi đè optimistic gây flicker/"rối" (kiểu Discord:
  // own actions là local-only, không reconcile từ server echo).
  const voiceChannel = `presence-voice-${channelId}`;
  // Payload đầy đủ (join route) → thêm/merge thẳng, KHỎI refetch (nhanh hơn).
  // Payload tối thiểu (webhook prod, không có `name`) → fallback refetch.
  useRealtimeEvent<Partial<Participant> & { userId: string }>(
    voiceChannel,
    'voice:join',
    (data) => {
      if (data.userId === currentUserId) return; // own user → VOICE_PRESENCE_EVENT lo
      if (typeof data?.name !== 'string') {
        void refetch();
        return;
      }
      const joined: Participant = {
        userId: data.userId,
        name: data.name,
        image: data.image ?? null,
        selfMuted: data.selfMuted ?? false,
        serverMuted: data.serverMuted ?? false,
        camera: data.camera ?? false,
        screenShare: data.screenShare ?? false,
        joinedAt: data.joinedAt ?? new Date().toISOString(),
      };
      setParticipants((prev) =>
        prev.some((p) => p.userId === joined.userId)
          ? prev // đã có → GIỮ NGUYÊN state (mic/cam do voice:state-changed quản);
                 // tránh voice:join đến TRỄ ghi đè selfMuted về true (mic-off)
          : [...prev, joined],
      );
    },
  );
  useRealtimeEvent<{ userId: string }>(voiceChannel, 'voice:leave', (data) => {
    if (data.userId === currentUserId) return;
    setParticipants((prev) => prev.filter((p) => p.userId !== data.userId));
  });
  useRealtimeEvent<{ userId: string; selfMuted?: boolean; camera?: boolean; screenShare?: boolean }>(
    voiceChannel,
    'voice:state-changed',
    (data) => {
      if (data.userId === currentUserId) return; // own user → VOICE_STATE_EVENT (instant) lo
      mergeState(data);
    },
  );

  if (loading || participants.length === 0) return null;

  return (
    <ul className="ml-6 mt-0.5 space-y-0.5 border-l border-divider pl-2">
      {participants.map((p) => {
        const name = p.name ?? 'Anonymous';
        const muted = p.selfMuted || p.serverMuted;
        return (
          <li key={p.userId}>
            <Link
              href={`/groups/${groupId}/${channelId}`}
              className="group/m flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/60"
              title={name}
            >
              <Avatar className="h-5 w-5 shrink-0">
                {p.image && <AvatarImage src={p.image} alt={name} />}
                <AvatarFallback className="text-[9px]">
                  {name[0]?.toUpperCase() ?? '?'}
                </AvatarFallback>
              </Avatar>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[12px]',
                  muted ? 'text-muted-foreground' : 'text-foreground/80',
                )}
              >
                {name}
              </span>
              {/* State icons — LUÔN hiện mic state (Discord-style). Cam + screen
                  chỉ hiện khi active để giảm noise.
                  Bọc span title vì lucide icon không chấp nhận `title` prop. */}
              <span className="flex shrink-0 items-center gap-0.5">
                {p.screenShare && (
                  <span title="Đang share màn hình">
                    <ScreenShare className="h-3 w-3 text-primary" />
                  </span>
                )}
                {p.camera && (
                  <span title="Camera đang bật">
                    <Video className="h-3 w-3 text-emerald-500" />
                  </span>
                )}
                {muted ? (
                  <span title={p.serverMuted ? 'Bị mute bởi mod' : 'Tự tắt mic'}>
                    <MicOff className="h-3 w-3 text-red-500" strokeWidth={2.5} />
                  </span>
                ) : (
                  <span title="Mic đang bật">
                    <Mic className="h-3 w-3 text-emerald-500" strokeWidth={2.5} />
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
