/**
 * VoiceSessionProvider — GIỮ phiên voice khi chuyển trang (kiểu Discord).
 *
 * Vấn đề cũ: <LiveKitRoom> mount trong trang channel → rời trang là unmount →
 * rớt voice. Giải: lift connection lên (app)/layout (provider này không unmount
 * khi đổi route).
 *
 * Cơ chế:
 *  - active = phiên đang kết nối (channel + token + user info).
 *  - Khi đang Ở trang channel đó → portal VoiceRoomUI vào "host" mà trang cung
 *    cấp (giao diện đầy đủ như cũ).
 *  - Khi sang trang khác → KHÔNG portal: render VoiceRoomUI ẩn (display:none —
 *    audio vẫn chạy, KHÔNG rớt) + hiện THANH NỔI (mic/quay lại/rời).
 *  - 1 instance VoiceRoomUI duy nhất → RoomAudioRenderer không nhân đôi.
 */
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

/**
 * Bắn local presence event → sidebar (VoiceChannelMembers) thêm/bỏ OWN user
 * NGAY 0ms, không chờ realtime (kiểu Discord optimistic).
 */
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
  /** Trang channel set host element để provider portal giao diện đầy đủ vào. */
  setHost: (channelId: string, el: HTMLElement | null) => void;
};

const VoiceSessionContext = React.createContext<Ctx | null>(null);

export function VoiceSessionProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState<ActiveSession | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [host, setHostEl] = React.useState<HTMLElement | null>(null);

  // Ref đọc active hiện tại trong callback (tránh side-effect trong setState updater).
  const activeRef = React.useRef<ActiveSession | null>(null);
  React.useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const postLeave = React.useCallback((channelId: string) => {
    fetch(`/api/channels/${channelId}/voice/leave`, { method: 'POST' }).catch(() => {});
  }, []);

  const leave = React.useCallback(() => {
    const cur = activeRef.current;
    if (cur) {
      // Optimistic: bỏ mình khỏi sidebar ngay (0ms) + báo server (→ realtime cho người khác).
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
        // Đang ở voice khác → rời trước (optimistic + báo server).
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
        setHostEl(null); // host của trang sẽ tự đăng ký lại

        // Optimistic: hiện mình trong sidebar NGAY (0ms) + bắn presence SỚM cho
        // người khác — KHÔNG chờ LiveKit connect (handshake media tốn 1-2s).
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

  // Trang channel đăng ký host element của nó để provider portal UI đầy đủ vào.
  //
  // CHỈ trang của channel ĐANG active mới render host div (VoiceChannel chỉ render
  // host khi isActiveHere) → mọi lần gọi với el!=null đều là của phiên hiện tại →
  // set thẳng, KHÔNG chặn bằng activeRef. Trước đây chặn bằng activeRef.current
  // (cập nhật trong useEffect, chạy SAU commit) nên ở vài luồng nó stale đúng lúc
  // host div mount → host không đăng ký → phòng đầy đủ không hiện, mini đè lên
  // trang channel → bấm "Về phòng đầy đủ" push về chính URL đang đứng = vô hiệu.
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

/** LiveKitRoom global + UI (portal khi on-page, ẩn + thanh nổi khi off-page). */
function VoiceSessionLayer({
  active,
  host,
  onLeave,
}: {
  active: ActiveSession;
  host: HTMLElement | null;
  onLeave: () => void;
}) {
  // Presence join đã POST SỚM trong join() (không chờ connect). KHÔNG re-POST ở
  // đây nữa: /voice/join re-upsert selfMuted=true → nếu đến SAU khi user bật mic
  // sẽ ghi đè state về mic-off (clobber cả DB lẫn sidebar). join() POST 1 lần đủ.
  const onConnected = undefined;
  const onMediaDeviceFailure = (failure?: MediaDeviceFailure) => {
    // PermissionDenied đã được VoiceControlBar.safeToggle bắt + toast CHÍNH XÁC
    // theo từng nút (mic/cam/màn hình). KHÔNG toast ở đây nữa để tránh:
    //   (1) báo "mic" sai khi user chỉ HUỶ picker chia sẻ màn hình (event này
    //       cũng fire cho getDisplayMedia), (2) toast trùng khi từ chối mic/cam thật.
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

  // Keep-alive media: giữ 1 <video> ẩn LUÔN PHÁT (canvas stream) suốt phiên voice
  // → trang luôn "đang phát media" → Chrome luôn đủ điều kiện auto-PiP, kể cả khi
  // phòng im lặng + mic tắt (trước auto "lúc được lúc không" vì điều kiện này
  // chập chờn theo tiếng/mic). LƯU Ý: Chrome CÒN đòi user-activation gần đây ở tab
  // → chưa tương tác với tab app thì vẫn không auto (luật trình duyệt, ko bypass).
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
      drawId = setInterval(paint, 1000); // giữ frame chảy → stream luôn "đang phát"
    } catch {
      /* trình duyệt không hỗ trợ → bỏ qua, vẫn dùng nút PiP bấm tay */
    }
    return () => {
      if (drawId) clearInterval(drawId);
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [pip.supported]);

  // Phân biệt PiP do AUTO mở (rời tab) vs do BẤM TAY:
  //  - auto  → quay lại tab thì TỰ ĐÓNG.
  //  - tay   → GIỮ tới khi user tự đóng / rời voice (không auto-đóng).
  const autoOpenedRef = React.useRef(false);
  const pipWindowRef = React.useRef(pip.pipWindow);
  pipWindowRef.current = pip.pipWindow;

  // Ref open/close: 2 hàm này đổi định danh mỗi lần PiP mở/đóng. Nếu để effect
  // dưới depend trực tiếp vào chúng, effect sẽ THÁO + ĐĂNG KÝ LẠI handler +
  // chớp playbackState='none' mỗi lượt PiP → sau vài lượt Chrome tưởng media
  // dừng và THU HỒI quyền auto-PiP. Truy cập qua ref để effect chạy 1 lần/phòng.
  const pipOpenRef = React.useRef(pip.open);
  pipOpenRef.current = pip.open;
  const pipCloseRef = React.useRef(pip.close);
  pipCloseRef.current = pip.close;

  // Mở PiP bằng nút bấm (có user gesture) → đánh dấu KHÔNG phải auto.
  const openManual = React.useCallback(() => {
    autoOpenedRef.current = false;
    void pip.open();
  }, [pip]);

  // Auto-PiP kiểu Google Meet: rời tab (document hidden) → tự mở; quay lại →
  // tự đóng (chỉ cái do auto mở). Chrome cho mở không cần click khi đang
  // capture mic; không thì pip.open() tự nuốt lỗi (no-op).
  React.useEffect(() => {
    if (!pip.supported || typeof navigator === 'undefined') return;
    const ms = navigator.mediaSession;
    const autoOpen = () => {
      if (pipWindowRef.current) return; // đã mở rồi (kể cả tay)
      autoOpenedRef.current = true;
      void pipOpenRef.current();
    };
    let setHandler: ((a: string, h: (() => void) | null) => void) | null = null;
    if (ms) {
      try {
        ms.metadata = new MediaMetadata({ title: active.channel.name, artist: 'Cogniva · Voice' });
        ms.playbackState = 'playing';
      } catch {
        /* ignore */
      }
      // 'enterpictureinpicture' chưa có trong type MediaSessionAction → cast.
      setHandler = ms.setActionHandler.bind(ms) as (a: string, h: (() => void) | null) => void;
      try {
        setHandler('enterpictureinpicture', autoOpen);
      } catch {
        /* chưa hỗ trợ auto qua mediaSession */
      }
    }
    const onVis = () => {
      if (document.hidden) {
        autoOpen();
      } else if (autoOpenedRef.current) {
        autoOpenedRef.current = false;
        pipCloseRef.current(); // chỉ đóng cái do auto mở; PiP bấm tay giữ nguyên
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (setHandler) {
        try {
          setHandler('enterpictureinpicture', null);
        } catch {
          /* ignore */
        }
      }
      // Dọn media session → OS không hiện "đang phát" lơ lửng sau khi rời voice.
      if (ms) {
        try {
          ms.playbackState = 'none';
          ms.metadata = null;
        } catch {
          /* ignore */
        }
      }
    };
    // CHỈ depend phòng + supported → effect ổn định, KHÔNG re-run mỗi lượt PiP
    // mở/đóng (pip.open/close truy cập qua ref ở trên).
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
      // audio={false}: KHÔNG tự publish mic khi connect → vô phòng mic TẮT
      // (mic nóng tự động là do prop `audio`/`audio={true}`). User tự bấm mic để
      // nói; mode 'Always Open' thì control bar tự bật. Playback tiếng người khác
      // do <RoomAudioRenderer> lo, không bị ảnh hưởng.
      audio={false}
      onConnected={onConnected}
      onDisconnected={onLeave}
      onMediaDeviceFailure={onMediaDeviceFailure}
      className="contents"
    >
      {/* Keep-alive: video ẩn luôn phát → giữ trang "đang phát media" cho auto-PiP */}
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
          {/* Ẩn nhưng VẪN mount → audio chạy tiếp, không rớt khi chuyển trang. */}
          <div className="hidden">{ui}</div>
          {/* Mini-player nổi TRONG app (video + điều khiển) — ẩn khi đã mở PiP. */}
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

      {/* Cửa sổ Document PiP (nổi ra ngoài tab/app khác) */}
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

/** Mini-player nổi TRONG app (góc dưới trái) — video + điều khiển, kiểu Meet. */
function FloatingVoicePlayer({
  channel,
  onLeave,
  onReturn,
  onPiP,
}: {
  channel: VoiceRoomMeta;
  onLeave: () => void;
  onReturn: () => void;
  /** Mở cửa sổ Document PiP (ra ngoài tab/app) — undefined nếu không hỗ trợ. */
  onPiP?: () => void;
}) {
  const host = useFloatingDockHost();
  const card = (
    <div className="pointer-events-auto h-52 w-72 overflow-hidden rounded-2xl border border-divider shadow-elevated">
      <VoiceMiniContent
        channelName={channel.name}
        onLeave={onLeave}
        onReturn={onReturn}
        onPiP={onPiP}
      />
    </div>
  );
  // Có host → xếp chung hàng với cửa sổ chat (không đè); chưa có → fixed.
  if (host) return createPortal(card, host);
  return <div className="fixed bottom-3 right-4 z-40">{card}</div>;
}
