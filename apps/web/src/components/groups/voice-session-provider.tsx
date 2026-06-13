'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { LiveKitRoom } from '@livekit/components-react';
import { MediaDeviceFailure } from 'livekit-client';
import { toast } from 'sonner';

import { useDocumentPiP } from '@/lib/use-document-pip';
import { useFloatingDockHost } from '@/components/app/floating-dock';

import { VoiceMiniContent, VoicePiPView } from './voice-pip-view';
import { VoiceRoomUI, type VoiceRoomMeta } from './voice-room-ui';
import { VOICE_PRESENCE_EVENT, type VoicePresenceEventDetail } from './voice-channel-members';

function dispatchVoicePresence(
  channelId: string,
  action: 'join' | 'leave',
  user: { userId: string; name: string | null; image: string | null },
) {
  if (typeof window === 'undefined') return;
  const detail: VoicePresenceEventDetail = { channelId, action, user };
  window.dispatchEvent(new CustomEvent(VOICE_PRESENCE_EVENT, { detail }));
}

type ActiveSession = {
  channel: VoiceRoomMeta;
  myRole: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  currentUserId: string;
  currentUserName: string;
  currentUserImage: string | null;
  token: string;
  url: string;
};

export type JoinParams = {
  channel: VoiceRoomMeta;
  myRole: ActiveSession['myRole'];
  currentUserId: string;
  currentUserName: string;
  currentUserImage: string | null;
};

type Ctx = {
  active: ActiveSession | null;
  connecting: boolean;
  join: (params: JoinParams) => Promise<void>;
  leave: () => void;
  setHost: (channelId: string, el: HTMLElement | null) => void;
};

const VoiceSessionContext = React.createContext<Ctx | null>(null);

export function VoiceSessionProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState<ActiveSession | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [host, setHostEl] = React.useState<HTMLElement | null>(null);

  const activeRef = React.useRef<ActiveSession | null>(null);
  React.useEffect(() => {
    activeRef.current = active;
  }, [active]);

  React.useEffect(() => {
    const onPageHide = () => {
      const cur = activeRef.current;
      if (cur && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/channels/${cur.channel.id}/voice/leave`);
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  const postLeave = React.useCallback((channelId: string) => {
    fetch(`/api/channels/${channelId}/voice/leave`, { method: 'POST' }).catch(() => {});
  }, []);

  const leave = React.useCallback(() => {
    const cur = activeRef.current;
    if (cur) {
      dispatchVoicePresence(cur.channel.id, 'leave', {
        userId: cur.currentUserId,
        name: cur.currentUserName,
        image: cur.currentUserImage,
      });
      postLeave(cur.channel.id);
    }
    activeRef.current = null;
    setActive(null);
    setHostEl(null);
  }, [postLeave]);

  const join = React.useCallback(
    async (params: JoinParams) => {
      setConnecting(true);
      try {
        const cur = activeRef.current;
        if (cur && cur.channel.id !== params.channel.id) {
          dispatchVoicePresence(cur.channel.id, 'leave', {
            userId: cur.currentUserId,
            name: cur.currentUserName,
            image: cur.currentUserImage,
          });
          postLeave(cur.channel.id);
        }
        const res = await fetch(`/api/channels/${params.channel.id}/voice/token`, {
          method: 'POST',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? `status ${res.status}`);
        }
        const data = (await res.json()) as { token: string; url: string };
        const next: ActiveSession = { ...params, token: data.token, url: data.url };
        activeRef.current = next;
        setActive(next);
        setHostEl(null);

        dispatchVoicePresence(params.channel.id, 'join', {
          userId: params.currentUserId,
          name: params.currentUserName,
          image: params.currentUserImage,
        });
        fetch(`/api/channels/${params.channel.id}/voice/join`, { method: 'POST' }).catch(() => {});
      } catch (err) {
        toast.error('Vào voice thất bại: ' + (err as Error).message);
      } finally {
        setConnecting(false);
      }
    },
    [postLeave],
  );

  const setHost = React.useCallback((_channelId: string, el: HTMLElement | null) => {
    setHostEl(el);
  }, []);

  return (
    <VoiceSessionContext.Provider value={{ active, connecting, join, leave, setHost }}>
      {children}
      {active && (
        <VoiceSessionLayer key={active.channel.id} active={active} host={host} onLeave={leave} />
      )}
    </VoiceSessionContext.Provider>
  );
}

export function useVoiceSession(): Ctx {
  const ctx = React.useContext(VoiceSessionContext);
  if (!ctx) throw new Error('useVoiceSession phải dùng trong <VoiceSessionProvider>');
  return ctx;
}

function VoiceSessionLayer({
  active,
  host,
  onLeave,
}: {
  active: ActiveSession;
  host: HTMLElement | null;
  onLeave: () => void;
}) {
  const onConnected = undefined;
  const onMediaDeviceFailure = (failure?: MediaDeviceFailure) => {
    if (failure === MediaDeviceFailure.NotFound) {
      toast.error('Không tìm thấy mic/cam.');
      return;
    }
    if (failure === MediaDeviceFailure.DeviceInUse) {
      toast.error('Mic/cam đang được app khác dùng.');
      return;
    }
  };

  const router = useRouter();
  const pip = useDocumentPiP();

  const keepAliveRef = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    if (!pip.supported) return;
    const video = keepAliveRef.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    let drawId: ReturnType<typeof setInterval> | null = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      const paint = () => {
        if (!ctx) return;
        ctx.fillStyle = '#0b0b0f';
        ctx.fillRect(0, 0, 16, 16);
      };
      paint();
      stream = (
        canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }
      ).captureStream(1);
      video.srcObject = stream;
      video.muted = true;
      void video.play().catch(() => {});
      drawId = setInterval(paint, 1000);
    } catch {}
    return () => {
      if (drawId) clearInterval(drawId);
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [pip.supported]);

  const autoOpenedRef = React.useRef(false);
  const pipWindowRef = React.useRef(pip.pipWindow);
  pipWindowRef.current = pip.pipWindow;

  const pipOpenRef = React.useRef(pip.open);
  pipOpenRef.current = pip.open;
  const pipCloseRef = React.useRef(pip.close);
  pipCloseRef.current = pip.close;

  const openManual = React.useCallback(() => {
    autoOpenedRef.current = false;
    void pip.open();
  }, [pip]);

  React.useEffect(() => {
    if (!pip.supported || typeof navigator === 'undefined') return;
    const ms = navigator.mediaSession;
    const autoOpen = () => {
      if (pipWindowRef.current) return;
      autoOpenedRef.current = true;
      void pipOpenRef.current();
    };
    let setHandler: ((a: string, h: (() => void) | null) => void) | null = null;
    if (ms) {
      try {
        ms.metadata = new MediaMetadata({ title: active.channel.name, artist: 'Cogniva · Voice' });
        ms.playbackState = 'playing';
      } catch {}
      setHandler = ms.setActionHandler.bind(ms) as (a: string, h: (() => void) | null) => void;
      try {
        setHandler('enterpictureinpicture', autoOpen);
      } catch {}
    }
    const onVis = () => {
      if (document.hidden) {
        autoOpen();
      } else if (autoOpenedRef.current) {
        autoOpenedRef.current = false;
        pipCloseRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (setHandler) {
        try {
          setHandler('enterpictureinpicture', null);
        } catch {}
      }
      if (ms) {
        try {
          ms.playbackState = 'none';
          ms.metadata = null;
        } catch {}
      }
    };
  }, [active.channel.name, pip.supported]);

  const ui = (
    <VoiceRoomUI
      channel={active.channel}
      myRole={active.myRole}
      currentUserId={active.currentUserId}
      currentUserName={active.currentUserName}
      currentUserImage={active.currentUserImage}
      onLeave={onLeave}
      onPiP={pip.supported ? openManual : undefined}
    />
  );

  const returnToChannel = () => {
    pip.close();
    router.push(`/groups/${active.channel.groupId}/${active.channel.id}`);
  };

  return (
    <LiveKitRoom
      token={active.token}
      serverUrl={active.url}
      connect
      video={false}
      audio={false}
      onConnected={onConnected}
      onDisconnected={onLeave}
      onMediaDeviceFailure={onMediaDeviceFailure}
      className="contents"
    >
      <video
        ref={keepAliveRef}
        muted
        playsInline
        aria-hidden
        className="pointer-events-none fixed bottom-0 right-0 h-px w-px opacity-0"
      />
      {host ? (
        createPortal(ui, host)
      ) : (
        <>
          <div className="hidden">{ui}</div>
          {!pip.pipWindow && (
            <FloatingVoicePlayer
              channel={active.channel}
              onLeave={onLeave}
              onReturn={returnToChannel}
              onPiP={pip.supported ? openManual : undefined}
            />
          )}
        </>
      )}

      {pip.pipWindow &&
        createPortal(
          <VoicePiPView
            channelName={active.channel.name}
            onLeave={() => {
              pip.close();
              onLeave();
            }}
            onReturn={returnToChannel}
          />,
          pip.pipWindow.document.body,
        )}
    </LiveKitRoom>
  );
}

function FloatingVoicePlayer({
  channel,
  onLeave,
  onReturn,
  onPiP,
}: {
  channel: VoiceRoomMeta;
  onLeave: () => void;
  onReturn: () => void;
  onPiP?: () => void;
}) {
  const host = useFloatingDockHost();
  const card = (
    <div className="border-divider shadow-elevated pointer-events-auto h-52 w-72 overflow-hidden rounded-2xl border">
      <VoiceMiniContent
        channelName={channel.name}
        onLeave={onLeave}
        onReturn={onReturn}
        onPiP={onPiP}
      />
    </div>
  );
  if (host) return createPortal(card, host);
  return <div className="fixed bottom-3 right-4 z-40">{card}</div>;
}
