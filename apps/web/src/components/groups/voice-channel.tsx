/**
 * VoiceChannel — wrapper mỏng cho VOICE channel.
 *
 * Connection LiveKit giờ do VoiceSessionProvider (global, ở (app)/layout) giữ —
 * KHÔNG mount ở đây nữa → rời trang không rớt voice (thanh nổi hiện thay).
 *
 * - Nếu phiên active chính là channel này → render 1 "host" div, provider portal
 *   giao diện đầy đủ (VoiceRoomUI) vào đó.
 * - Nếu chưa vào / đang ở voice khác → màn pre-join "Vào voice".
 */
'use client';

import * as React from 'react';
import { Loader2, Volume2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { StudyGroupChannel } from '@cogniva/db';

import { VoiceRecordingBanner } from './voice-record-control';
import { VoiceRecordingsList } from './voice-recordings-list';
import { useVoiceSession } from './voice-session-provider';
import type { VoiceRoomMeta } from './voice-room-ui';

type Props = {
  channel: StudyGroupChannel;
  myRole: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  currentUserId: string;
  currentUserName: string;
  currentUserImage: string | null;
};

export function VoiceChannel({
  channel,
  myRole,
  currentUserId,
  currentUserName,
  currentUserImage,
}: Props) {
  const { active, connecting, join, setHost } = useVoiceSession();
  const isActiveHere = active?.channel.id === channel.id;
  const inOtherVoice = !!active && !isActiveHere;
  const canRecord = myRole !== 'MEMBER';

  // Đăng ký host element để provider portal UI đầy đủ vào (null khi unmount).
  const hostRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      setHost(channel.id, el);
    },
    [channel.id, setHost],
  );

  if (isActiveHere) {
    return <div ref={hostRef} className="h-full" />;
  }

  const onJoin = () => {
    const meta: VoiceRoomMeta = {
      id: channel.id,
      name: channel.name,
      topic: channel.topic,
      groupId: channel.groupId,
    };
    void join({ channel: meta, myRole, currentUserId, currentUserName, currentUserImage });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Lobby pre-join để TỐI đồng bộ với voice room (Discord — voice luôn tối
          mọi theme). Cũng để nút toggle nổi (style tối) hiện rõ, không tàng hình. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-900/90 pl-12 pr-12 text-white md:pl-4 md:pr-4 lg:pr-14">
        <Volume2 className="h-4 w-4 shrink-0 text-white/60" />
        <span className="truncate font-semibold">{channel.name}</span>
        {channel.topic && (
          <>
            <span className="hidden h-4 w-px bg-white/10 sm:block" />
            <span className="hidden truncate text-xs text-white/50 sm:inline">
              {channel.topic}
            </span>
          </>
        )}
      </header>
      <VoiceRecordingBanner channelId={channel.id} />
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-zinc-950 p-6">
        {/* Ánh sáng nền dịu — dùng token voice-active (===primary) thay vì hex indigo/purple */}
        <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-voice-active/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/5 p-8 text-white shadow-xl backdrop-blur-md">
          {/* Icon badge — voice-active === primary, dùng token thay gradient indigo/purple */}
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-voice-active text-white shadow-lg">
            <Volume2 className="h-8 w-8" />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold">#{channel.name}</h2>
            <p className="mt-1.5 text-sm text-white/60">
              Voice realtime + Notes + Whiteboard + Pomodoro — đầy đủ như Study Room
            </p>
            {inOtherVoice && (
              <p className="mt-2 text-[12px] font-medium text-amber-400">
                Bạn đang ở voice #{active!.channel.name} — vào đây sẽ chuyển sang.
              </p>
            )}
          </div>
          {/* "Vào voice" — voice-active === primary (#6366f1) → Button default,
              bỏ gradient indigo/purple để gọn + có shadow-primary chuẩn. */}
          <Button onClick={onJoin} disabled={connecting} size="lg" className="w-full">
            {connecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Đang kết nối...
              </>
            ) : (
              <>
                <Volume2 className="mr-2 h-4 w-4" />
                {inOtherVoice ? 'Chuyển vào voice này' : 'Vào voice'}
              </>
            )}
          </Button>
        </div>
      </div>
      <VoiceRecordingsList channelId={channel.id} canDelete={canRecord} />
    </div>
  );
}
