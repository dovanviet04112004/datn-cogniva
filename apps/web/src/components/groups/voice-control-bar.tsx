'use client';

import * as React from 'react';
import { useConnectionState, useRoomContext, useTrackToggle } from '@livekit/components-react';
import {
  ConnectionState,
  RoomEvent,
  Track,
  type RemoteAudioTrack,
  type RemoteTrack,
} from 'livekit-client';
import {
  Hand,
  Headphones,
  HeadphoneOff,
  LogOut,
  Mic,
  MicOff,
  MoreHorizontal,
  ScreenShare,
  ScreenShareOff,
  Settings,
  Video,
  VideoOff,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ReactionPicker } from '@/components/rooms/reaction-picker';

import { VoiceRecordControl } from './voice-record-control';
import { VoiceSettingsDialog } from './voice-settings-dialog';
import { VOICE_STATE_EVENT, type VoiceStateEventDetail } from './voice-state-sync';
import { RAISE_HAND_SELF_EVENT, useIsMobile } from './voice-stage';
import { VoicePrefsProvider, useVoicePrefs } from '@/lib/group/voice-prefs';

type Props = {
  channelId: string;
  currentUserId: string;
  canRecord: boolean;
  onLeave: () => void;
};

export function VoiceControlBar(props: Props) {
  return (
    <VoicePrefsProvider>
      <ControlBarInner {...props} />
    </VoicePrefsProvider>
  );
}

function useSheetSwipe(onOpen: () => void, onClose: () => void) {
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const make = (dir: 'up' | 'down') => ({
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      const t = e.changedTouches[0];
      start.current = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 40) return;
      if (dir === 'up' && dy < -50) onOpen();
      else if (dir === 'down' && dy > 50) onClose();
    },
  });
  return { barHandlers: make('up'), sheetHandlers: make('down') };
}

function ControlBarInner({ channelId, currentUserId, canRecord, onLeave }: Props) {
  const room = useRoomContext();
  const { prefs } = useVoicePrefs();
  const connState = useConnectionState();
  const connected = connState === ConnectionState.Connected;
  const {
    toggle: rawToggleMic,
    enabled: micOn,
    pending: micPending,
  } = useTrackToggle({ source: Track.Source.Microphone });
  const {
    toggle: rawToggleCam,
    enabled: camOn,
    pending: camPending,
  } = useTrackToggle({ source: Track.Source.Camera });
  const {
    toggle: rawToggleScreen,
    enabled: screenOn,
    pending: screenPending,
  } = useTrackToggle({ source: Track.Source.ScreenShare });

  const [deafened, setDeafened] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const micBeforeDeafenRef = React.useRef<boolean>(false);

  const safeToggle = React.useCallback(
    (toggle: (forceState?: boolean) => Promise<unknown>, kind: 'mic' | 'cam' | 'screen') =>
      async (forceState?: boolean) => {
        try {
          await toggle(forceState);
        } catch (err) {
          const e = err as DOMException;
          if (e.name === 'NotAllowedError') {
            if (kind === 'screen') return;
            const label = kind === 'mic' ? 'mic' : 'camera';
            toast.error(`Cần cấp quyền ${label} — click icon 🔒 cạnh URL → Cho phép.`, {
              duration: 6000,
            });
          } else if (e.name === 'NotFoundError') {
            toast.error('Không tìm thấy thiết bị — kiểm tra mic/cam đã cắm.');
          } else if (e.name === 'NotReadableError') {
            toast.error('Thiết bị đang được dùng bởi app khác.');
          } else {
            console.error(`[voice] toggle ${kind}:`, err);
            toast.error(`Toggle ${kind} lỗi: ${e.message ?? 'unknown'}`);
          }
        }
      },
    [],
  );

  const toggleMic = React.useMemo(
    () => safeToggle(rawToggleMic, 'mic'),
    [rawToggleMic, safeToggle],
  );
  const toggleCam = React.useMemo(
    () => safeToggle(rawToggleCam, 'cam'),
    [rawToggleCam, safeToggle],
  );
  const toggleScreen = React.useMemo(
    () => safeToggle(rawToggleScreen, 'screen'),
    [rawToggleScreen, safeToggle],
  );

  const emitState = React.useCallback(
    (selfMuted: boolean, camera: boolean, screenShare: boolean) => {
      if (!currentUserId) return;
      const detail: VoiceStateEventDetail = {
        channelId,
        userId: currentUserId,
        selfMuted,
        camera,
        screenShare,
      };
      window.dispatchEvent(new CustomEvent(VOICE_STATE_EVENT, { detail }));
    },
    [channelId, currentUserId],
  );

  const clickMic = React.useCallback(() => {
    if (!connected || prefs.mode === 'ptt' || micPending) return;
    const target = !micOn;
    emitState(!target, camOn, screenOn);
    void toggleMic(target);
  }, [connected, prefs.mode, micPending, micOn, camOn, screenOn, emitState, toggleMic]);

  const clickCam = React.useCallback(() => {
    if (!connected || camPending) return;
    void toggleCam(!camOn);
  }, [connected, camPending, camOn, toggleCam]);

  const clickScreen = React.useCallback(() => {
    if (!connected || screenPending) return;
    void toggleScreen(!screenOn);
  }, [connected, screenPending, screenOn, toggleScreen]);

  React.useEffect(() => {
    if (!connected) return;
    if (prefs.mode === 'ptt' && micOn) {
      void toggleMic(false);
    } else if (prefs.mode === 'open' && !micOn) {
      void toggleMic(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.mode, connected]);

  const raiseHand = React.useCallback(async () => {
    try {
      const payload = new TextEncoder().encode(
        JSON.stringify({ type: 'RAISE_HAND', at: Date.now() }),
      );
      await room.localParticipant.publishData(payload, { reliable: true });
      window.dispatchEvent(
        new CustomEvent(RAISE_HAND_SELF_EVENT, {
          detail: { identity: room.localParticipant.identity },
        }),
      );
      toast.success('Đã giơ tay');
    } catch (err) {
      toast.error('Gửi tín hiệu thất bại');
      console.error(err);
    }
  }, [room]);

  const toggleDeafen = React.useCallback(() => {
    const next = !deafened;
    setDeafened(next);
    room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub) => {
        const track = pub.track;
        if (track && track.kind === Track.Kind.Audio) {
          (track as RemoteAudioTrack).setVolume(next ? 0 : 1);
        }
      });
    });
    if (next) {
      micBeforeDeafenRef.current = micOn;
      if (micOn) void toggleMic(false);
    } else {
      if (micBeforeDeafenRef.current && !micOn) void toggleMic(true);
    }
  }, [deafened, micOn, room, toggleMic]);

  React.useEffect(() => {
    if (!deafened) return;
    const onTrackSubscribed = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        (track as RemoteAudioTrack).setVolume(0);
      }
    };
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    };
  }, [deafened, room]);

  React.useEffect(() => {
    if (prefs.mode !== 'ptt') return;
    let isHeld = false;

    const matchKey = (e: KeyboardEvent) => {
      return e.code === prefs.pttKey;
    };

    const onDown = (e: KeyboardEvent) => {
      if (!matchKey(e)) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      if (deafened) return;
      if (isHeld) return;
      isHeld = true;
      e.preventDefault();
      void toggleMic(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (!matchKey(e)) return;
      if (!isHeld) return;
      isHeld = false;
      e.preventDefault();
      void toggleMic(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [prefs.mode, prefs.pttKey, deafened, toggleMic]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      const k = e.key.toLowerCase();
      if (k === 'm' && prefs.mode !== 'ptt') clickMic();
      else if (k === 'v') clickCam();
      else if (k === 's') clickScreen();
      else if (k === 'h') void raiseHand();
      else if (k === 'd') toggleDeafen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prefs.mode, clickMic, clickCam, clickScreen, raiseHand, toggleDeafen]);

  const micDisabled = prefs.mode === 'ptt';

  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const { barHandlers, sheetHandlers } = useSheetSwipe(
    React.useCallback(() => setSheetOpen(true), []),
    React.useCallback(() => setSheetOpen(false), []),
  );
  React.useEffect(() => {
    if (!isMobile) setSheetOpen(false);
  }, [isMobile]);

  const micBtn = (
    <ControlBtn
      active={micOn}
      onClick={clickMic}
      OnIcon={Mic}
      OffIcon={MicOff}
      label={
        !connected
          ? 'Đang kết nối voice...'
          : micDisabled
            ? 'PTT mode — giữ phím để nói'
            : micOn
              ? 'Tắt mic (M)'
              : 'Bật mic (M)'
      }
      offClass="bg-red-500 text-white hover:bg-red-600"
      disabled={!connected || micDisabled || micPending}
    />
  );
  const deafenBtn = (
    <ControlBtn
      active={!deafened}
      onClick={toggleDeafen}
      OnIcon={Headphones}
      OffIcon={HeadphoneOff}
      label={deafened ? 'Bật tai nghe (D)' : 'Tắt tai nghe (D)'}
      offClass="bg-red-500 text-white hover:bg-red-600"
    />
  );
  const camBtn = (
    <ControlBtn
      active={camOn}
      onClick={clickCam}
      OnIcon={Video}
      OffIcon={VideoOff}
      label={!connected ? 'Đang kết nối voice...' : camOn ? 'Tắt camera (V)' : 'Bật camera (V)'}
      disabled={!connected || camPending}
    />
  );
  const screenBtn = (
    <ControlBtn
      active={screenOn}
      onClick={clickScreen}
      OnIcon={ScreenShare}
      OffIcon={ScreenShareOff}
      label={
        !connected
          ? 'Đang kết nối voice...'
          : screenOn
            ? 'Dừng chia sẻ (S)'
            : 'Chia sẻ màn hình (S)'
      }
      activeClass="bg-primary text-primary-foreground hover:bg-primary-hover"
      disabled={!connected || screenPending}
    />
  );
  const leaveBtn = (
    <Button
      onClick={onLeave}
      size="sm"
      className="h-10 gap-1.5 rounded-full bg-red-600 px-3.5 text-white transition-all hover:bg-red-700 active:scale-95"
      aria-label="Rời voice channel"
      title="Rời voice channel"
    >
      <LogOut className="h-[18px] w-[18px]" />
      <span className="hidden text-sm font-medium sm:inline">Rời</span>
    </Button>
  );

  if (!isMobile) {
    return (
      <>
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-zinc-900/90 px-3 py-3 backdrop-blur-md">
          {micBtn}
          {deafenBtn}
          {camBtn}
          {screenBtn}

          <div className="mx-1 h-6 w-px bg-white/10" />

          <Button
            onClick={raiseHand}
            size="sm"
            className="h-10 w-10 rounded-full bg-white/10 p-0 text-white transition-all hover:bg-white/20 active:scale-95"
            aria-label="Giơ tay (H)"
            title="Giơ tay (H)"
          >
            <Hand className="h-[18px] w-[18px]" />
          </Button>
          <ReactionPicker />
          <VoiceRecordControl channelId={channelId} canRecord={canRecord} />
          <Button
            onClick={() => setSettingsOpen(true)}
            size="sm"
            className="h-10 w-10 rounded-full bg-white/10 p-0 text-white transition-all hover:bg-white/20 active:scale-95"
            aria-label="Cài đặt voice"
            title="Cài đặt voice"
          >
            <Settings className="h-[18px] w-[18px]" />
          </Button>

          <div className="mx-1 h-6 w-px bg-white/10" />

          {leaveBtn}
        </div>

        <VoiceSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </>
    );
  }

  return (
    <>
      <div className="relative">
        <div
          {...sheetHandlers}
          role="group"
          aria-label="Thêm điều khiển voice"
          aria-hidden={!sheetOpen}
          className={cn(
            'shadow-elevated absolute inset-x-0 bottom-full z-20 border-t border-white/10 bg-zinc-900/95 px-3 pb-3 pt-1 backdrop-blur-md transition-all duration-300 ease-out',
            sheetOpen
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-full opacity-0',
          )}
        >
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            aria-label="Đóng bảng điều khiển"
            className="mx-auto mb-2 flex h-5 w-full items-center justify-center"
          >
            <span className="h-1.5 w-10 rounded-full bg-white/30" />
          </button>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                void raiseHand();
                setSheetOpen(false);
              }}
              className="flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] py-3 text-sm font-medium text-white ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.14] active:scale-[0.98]"
            >
              <Hand className="h-[18px] w-[18px]" /> Giơ tay
            </button>
            <div className="flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] py-3 text-sm font-medium text-white ring-1 ring-inset ring-white/10">
              <ReactionPicker />
              <span>Cảm xúc</span>
            </div>
            <div className="col-span-2 flex items-center justify-center rounded-xl bg-white/[0.04] py-3 ring-1 ring-inset ring-white/10">
              <VoiceRecordControl channelId={channelId} canRecord={canRecord} />
            </div>
            <button
              type="button"
              onClick={() => {
                setSettingsOpen(true);
                setSheetOpen(false);
              }}
              className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] py-3 text-sm font-medium text-white ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.14] active:scale-[0.98]"
            >
              <Settings className="h-[18px] w-[18px]" /> Cài đặt voice
            </button>
          </div>
        </div>

        <div
          {...barHandlers}
          className="relative z-20 flex items-center justify-center gap-2 border-t border-white/10 bg-zinc-900/90 px-3 py-3 backdrop-blur-md"
        >
          {micBtn}
          {deafenBtn}
          {camBtn}
          {screenBtn}
          <Button
            onClick={() => setSheetOpen((v) => !v)}
            size="sm"
            aria-label="Thêm điều khiển"
            aria-expanded={sheetOpen}
            title="Thêm điều khiển (vuốt lên)"
            className={cn(
              'h-10 w-10 rounded-full p-0 text-white transition-all active:scale-95',
              sheetOpen ? 'bg-white/20' : 'bg-white/10 hover:bg-white/20',
            )}
          >
            <MoreHorizontal className="h-[18px] w-[18px]" />
          </Button>
          {leaveBtn}
        </div>
      </div>

      <VoiceSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

type CtrlProps = {
  active: boolean;
  onClick: () => void;
  OnIcon: React.ComponentType<{ className?: string }>;
  OffIcon: React.ComponentType<{ className?: string }>;
  label: string;
  activeClass?: string;
  offClass?: string;
  disabled?: boolean;
};

function ControlBtn({
  active,
  onClick,
  OnIcon,
  OffIcon,
  label,
  activeClass,
  offClass,
  disabled,
}: CtrlProps) {
  const Icon = active ? OnIcon : OffIcon;
  return (
    <Button
      onClick={onClick}
      size="sm"
      disabled={disabled}
      className={cn(
        'h-10 w-10 rounded-full p-0 transition-all duration-150 active:scale-95',
        active
          ? (activeClass ?? 'bg-white/10 text-white hover:bg-white/20')
          : (offClass ?? 'bg-white/10 text-white hover:bg-white/20'),
        disabled && 'cursor-not-allowed opacity-50',
      )}
      aria-label={label}
      title={label}
    >
      <Icon className="h-[18px] w-[18px]" />
    </Button>
  );
}
