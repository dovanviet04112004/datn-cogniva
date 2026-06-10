/**
 * VoiceStage — UI participants của VOICE channel (study group), mô phỏng Discord.
 *
 * Mô hình Discord:
 *   - GRID mặc định: mỗi người 1 tile (avatar/camera) + mỗi màn-share 1 tile
 *     RIÊNG có nút "Xem Stream" (KHÔNG auto-spotlight).
 *   - Bấm "Xem Stream" (hoặc double-click tile stream) → FOCUS: màn share to ở
 *     trên, dải participant ngang ở đáy, nút "Quay lại lưới".
 *   - Tile: nền màu theo hue per-user, ring xanh khi đang nói, name-pill tối gọn
 *     (icon mic + tên) góc dưới-trái — đúng kiểu Discord.
 *   - Toàn màn hình: hover hiện nút ⛶, hoặc double-click; double-click stream
 *     tile để xem.
 *
 * LƯU Ý track local: `onlySubscribed: false` — user KHÔNG subscribe track của
 * chính mình; để true thì cam/share của mình sẽ không hiện.
 */
'use client';

import * as React from 'react';
import {
  useParticipants,
  useIsSpeaking,
  useIsMuted,
  useRoomContext,
  useTracks,
  TrackRefContext,
  VideoTrack,
  AudioTrack,
  RoomAudioRenderer,
  type TrackReference,
} from '@livekit/components-react';
import { Track, type Participant, type RemoteParticipant } from 'livekit-client';
import { ArrowLeft, Hand, Maximize2, Minimize2, Mic, MicOff, MonitorPlay, ScreenShare } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Window event để CHÍNH người giơ tay cũng thấy badge của mình (LiveKit không
 *  loopback data channel về local participant). */
export const RAISE_HAND_SELF_EVENT = 'cogniva:raise-hand-self';
/** Giơ tay hiện badge ✋ trong bao lâu rồi tự hạ (ms). */
const RAISE_HAND_TTL = 12_000;

/**
 * Hash deterministic identity → HSL hue. Mỗi user MỘT màu ổn định (không phải
 * 1 màu cố định cho tất cả) — "màu theo hệ thống" kiểu Discord.
 */
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

type Props = {
  /** Map identity → metadata (avatar URL từ Cogniva). */
  participantMeta?: Record<string, { avatar?: string | null; role?: string }>;
  /**
   * Ref tới phần tử vào toàn màn hình — thường là `<main>` (gồm control bar) để
   * fullscreen vẫn thấy điều khiển. Không truyền → fallback khung video.
   */
  fullscreenRef?: React.RefObject<HTMLElement | null>;
};

/** Hook toggle toàn màn hình cho 1 element ref + theo dõi trạng thái. */
function useFullscreen(targetRef: React.RefObject<HTMLElement | null>) {
  const [isFs, setIsFs] = React.useState(false);
  React.useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggle = React.useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  }, [targetRef]);
  return { isFs, toggle };
}

/** Cụm điều khiển góc trên-phải khung video — ẩn, HIỆN KHI HOVER (Discord-style). */
function VideoHoverControls({ isFs, onToggleFs }: { isFs: boolean; onToggleFs: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end bg-gradient-to-b from-black/45 to-transparent p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
      <button
        type="button"
        onClick={onToggleFs}
        aria-label={isFs ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
        title={isFs ? 'Thoát toàn màn hình (Esc)' : 'Toàn màn hình (hoặc double-click)'}
        className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
      >
        {isFs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Số cột grid theo số tile (giống Discord: 1 / 2 / 2-3 / 3-4 / 4+). */
function gridCols(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return 5;
}

/**
 * Phát hiện viewport mobile (< sm = 640px) để chỉnh grid kiểu Discord mobile.
 * Mounted-guard: default false (khớp SSR), set sau mount → không lo hydrate.
 */
export function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);
  return isMobile;
}

export function VoiceStage({ participantMeta = {}, fullscreenRef }: Props) {
  const participants = useParticipants();
  const mainVideoRef = React.useRef<HTMLDivElement>(null);
  const fsRef = fullscreenRef ?? mainVideoRef;
  const { isFs, toggle: toggleFs } = useFullscreen(fsRef);
  const isMobile = useIsMobile();

  // Tile stream đang được "Xem" (focus). null = đang ở GRID.
  const [focusedSid, setFocusedSid] = React.useState<string | null>(null);

  // Giơ tay — set identity đang giơ; badge ✋ trên tile, tự hạ sau TTL.
  const room = useRoomContext();
  const [raisedIds, setRaisedIds] = React.useState<Set<string>>(() => new Set());
  const markRaised = React.useCallback((identity: string) => {
    setRaisedIds((prev) => new Set(prev).add(identity));
    setTimeout(() => {
      setRaisedIds((prev) => {
        const next = new Set(prev);
        next.delete(identity);
        return next;
      });
    }, RAISE_HAND_TTL);
  }, []);
  React.useEffect(() => {
    // Người KHÁC giơ tay → data channel (kèm participant gửi).
    const onData = (payload: Uint8Array, participant?: RemoteParticipant) => {
      try {
        const d = JSON.parse(new TextDecoder().decode(payload));
        if (d?.type === 'RAISE_HAND' && participant?.identity) markRaised(participant.identity);
      } catch {
        /* ignore */
      }
    };
    room.on('dataReceived', onData);
    // CHÍNH MÌNH giơ tay → window event (LiveKit không loopback data về local).
    const onSelf = (e: Event) => {
      const id = (e as CustomEvent<{ identity: string }>).detail?.identity;
      if (id) markRaised(id);
    };
    window.addEventListener(RAISE_HAND_SELF_EVENT, onSelf);
    return () => {
      room.off('dataReceived', onData);
      window.removeEventListener(RAISE_HAND_SELF_EVENT, onSelf);
    };
  }, [room, markRaised]);

  // onlySubscribed:false để cả track LOCAL (mình share/bật cam) lẫn remote hiện.
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).filter(
    (t): t is TrackReference => !!t.publication?.track && !t.publication.isMuted,
  );
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false }).filter(
    (t): t is TrackReference => !!t.publication?.track && !t.publication.isMuted,
  );

  const focusedTrack = screenTracks.find((t) => t.publication?.trackSid === focusedSid);
  // Stream bị dừng khi đang focus → tự về grid.
  React.useEffect(() => {
    if (focusedSid && !focusedTrack) setFocusedSid(null);
  }, [focusedSid, focusedTrack]);

  const camFor = React.useCallback(
    (identity: string) => cameraTracks.find((t) => t.participant.identity === identity),
    [cameraTracks],
  );

  // ── FOCUS (Xem Stream) — màn share to ở trên + dải participant ở đáy ──
  if (focusedTrack) {
    return (
      <StageShell>
        <div className="relative z-10 flex h-full flex-1 flex-col gap-3 p-3 sm:p-4">
          {/* Vùng canh giữa — video tự co theo nội dung (KHÔNG ép full → hết
              "hộp đen kéo dài"); nền vùng dùng theme, không phải khối đen to. */}
          <div
            ref={mainVideoRef}
            onDoubleClick={toggleFs}
            className="group relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          >
            <VideoHoverControls isFs={isFs} onToggleFs={toggleFs} />
            {/* Nút quay lại lưới — góc trên-trái, hiện khi hover */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-start bg-gradient-to-b from-black/45 to-transparent p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <button
                type="button"
                onClick={() => setFocusedSid(null)}
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-black/55 px-3 py-2 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/75"
              >
                <ArrowLeft className="h-4 w-4" /> Quay lại lưới
              </button>
            </div>
            <TrackRefContext.Provider value={focusedTrack}>
              <VideoTrack
                trackRef={focusedTrack}
                style={{ objectFit: 'contain' }}
                className="max-h-full max-w-full rounded-2xl border border-white/10 bg-black object-contain shadow-elevated"
              />
            </TrackRefContext.Provider>
            <SharerLabel name={focusedTrack.participant.name ?? focusedTrack.participant.identity} />
          </div>
          <div className="flex h-20 shrink-0 items-stretch justify-center gap-2 overflow-x-auto sm:h-24">
            {participants.map((p) => (
              <div key={p.identity} className="aspect-video h-full shrink-0">
                <ParticipantTile
                  participant={p}
                  meta={participantMeta[p.identity]}
                  camTrack={camFor(p.identity)}
                  raised={raisedIds.has(p.identity)}
                  compact
                />
              </div>
            ))}
          </div>
        </div>
      </StageShell>
    );
  }

  // ── GRID — mỗi người 1 tile + mỗi stream 1 tile (Xem Stream) ──
  const tileCount = participants.length + screenTracks.length;
  // Mobile (Discord-style): tối đa 2 cột; ≤2 người → 1 cột để tile RỘNG (đỡ
  // cao-hẹp xấu). Stream tile tự span full-width (xem StreamTile col-span-full).
  const cols = isMobile ? (participants.length <= 2 ? 1 : 2) : gridCols(tileCount);

  return (
    <StageShell>
      {/* Tile là CARD aspect-video (kiểu Discord) — KHÔNG kéo dãn lấp full màn.
          Ít người → căn giữa; nhiều người vượt khung → cuộn dọc. max-w-5xl để
          desktop 1 người không phình quá to. */}
      <div className="relative z-10 flex min-h-0 flex-1 justify-center overflow-y-auto">
        <div
          className="grid w-full min-h-full max-w-5xl content-center items-center gap-3 p-4 sm:p-6"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {/* Stream tiles trước (nổi bật) */}
          {screenTracks.map((t) => (
            <StreamTile
              key={t.publication?.trackSid}
              track={t}
              onWatch={() => setFocusedSid(t.publication?.trackSid ?? null)}
            />
          ))}
          {/* Person tiles */}
          {participants.map((p) => (
            <ParticipantTile
              key={p.identity}
              participant={p}
              meta={participantMeta[p.identity]}
              camTrack={camFor(p.identity)}
              raised={raisedIds.has(p.identity)}
            />
          ))}
        </div>
      </div>
    </StageShell>
  );
}

/** Khung nền stage (gradient theo theme + mesh primary mờ). */
function StageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-zinc-950">
      <RoomAudioRenderer />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 30%, hsl(var(--primary)) 0%, transparent 45%), radial-gradient(circle at 80% 70%, hsl(var(--primary)) 0%, transparent 45%)',
        }}
      />
      {children}
    </div>
  );
}

/** Nhãn người share — pill tối gọn kiểu Discord (chấm đỏ "live"). */
function SharerLabel({ name }: { name: string }) {
  return (
    <div className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[11.5px] font-medium text-white backdrop-blur">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
      <ScreenShare className="h-3 w-3 text-white/80" />
      {name}
    </div>
  );
}

/** Tile STREAM trong lưới — preview mờ + nút "Xem Stream" (Discord-style). */
function StreamTile({ track, onWatch }: { track: TrackReference; onWatch: () => void }) {
  const name = track.participant.name ?? track.participant.identity;
  return (
    <div
      onDoubleClick={onWatch}
      className="group relative col-span-full flex aspect-video max-h-[68vh] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black sm:col-auto"
    >
      <TrackRefContext.Provider value={track}>
        <VideoTrack trackRef={track} className="absolute inset-0 h-full w-full object-cover opacity-50" />
      </TrackRefContext.Provider>
      <button
        type="button"
        onClick={onWatch}
        className="relative z-10 inline-flex items-center gap-2 rounded-lg bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition-all hover:scale-105 hover:bg-black/85"
      >
        <MonitorPlay className="h-4 w-4" /> Xem Stream
      </button>
      <SharerLabel name={name} />
    </div>
  );
}

type TileProps = {
  participant: Participant;
  meta?: { avatar?: string | null; role?: string };
  camTrack?: TrackReference;
  /** Đang giơ tay → hiện badge ✋. */
  raised?: boolean;
  compact?: boolean;
};

/** Tile NGƯỜI — camera/avatar + name-pill mic kiểu Discord + ring khi nói. */
function ParticipantTile({ participant, meta, camTrack, raised = false, compact = false }: TileProps) {
  const speaking = useIsSpeaking(participant);
  const name = participant.name ?? participant.identity;
  const initials = (name || '?').slice(0, 2).toUpperCase();

  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  // Reactive mute: hook subscribe LiveKit TrackMuted/TrackUnmuted → tile RE-RENDER khi
  // participant bật/tắt mic. (Đọc thẳng `micPub.isMuted` KHÔNG reactive → icon mic bị stale,
  // chỉ "ăn may" cập nhật khi tile re-render vì lý do khác → lệch với sidebar.)
  const micRef = React.useMemo(
    () => ({ participant, source: Track.Source.Microphone, publication: micPub }),
    [participant, micPub],
  );
  const micMuted = useIsMuted(micRef);
  const micOn = !!micPub && !micMuted;
  const camOn = !!camTrack && !camTrack.publication?.isMuted;

  const hue = hueFromString(participant.identity);
  const avatarUrl = meta?.avatar;
  const role = meta?.role;
  const isMod = role === 'OWNER' || role === 'ADMIN' || role === 'MODERATOR';

  return (
    <div
      style={camOn ? undefined : { background: `linear-gradient(150deg, hsl(${hue} 34% 30%), hsl(${(hue + 12) % 360} 38% 18%))` }}
      className={cn(
        'group relative flex items-center justify-center overflow-hidden rounded-2xl border transition-all',
        // Grid: card aspect-video (Discord) + CHẶN cao max-h-[68vh] (chừa header
        // + control bar) → không tràn/cuộn dù màn rộng. Strip focus mode (compact):
        // fill ô wrapper aspect-video h-full sẵn có.
        compact ? 'h-full w-full' : 'aspect-video max-h-[68vh]',
        camOn ? 'bg-black' : 'backdrop-blur-sm',
        speaking
          ? 'border-emerald-400/80 shadow-[0_0_22px_rgba(52,211,153,0.5)]'
          : 'border-white/10',
      )}
    >
      {/* Audio render (volume xử lý bởi RoomAudioRenderer global) */}
      {micPub?.audioTrack && (
        <TrackRefContext.Provider
          value={{ participant, publication: micPub, source: Track.Source.Microphone }}
        >
          <AudioTrack
            trackRef={{ participant, publication: micPub, source: Track.Source.Microphone }}
          />
        </TrackRefContext.Provider>
      )}

      {camOn && camTrack ? (
        <TrackRefContext.Provider value={camTrack}>
          <VideoTrack trackRef={camTrack} className="absolute inset-0 h-full w-full object-cover" />
        </TrackRefContext.Provider>
      ) : (
        <div
          style={avatarUrl ? undefined : { backgroundColor: `hsl(${hue} 45% 50%)` }}
          className={cn(
            'relative flex items-center justify-center overflow-hidden rounded-full font-semibold text-white shadow-lg ring-4 transition-all',
            compact ? 'h-12 w-12 text-base' : 'h-16 w-16 text-xl sm:h-20 sm:w-20 sm:text-2xl',
            speaking ? 'ring-emerald-400/70' : 'ring-white/10',
          )}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <span>{initials}</span>
          )}
        </div>
      )}

      {/* Name-pill Discord-style — góc dưới-trái: icon mic + tên */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 flex items-center justify-start p-2',
          compact && 'p-1.5',
        )}
      >
        <div
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-white backdrop-blur',
            compact && 'gap-1 px-1.5 py-0.5',
          )}
        >
          {micOn ? (
            <Mic className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
          ) : (
            <MicOff className={cn('text-red-400', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
          )}
          <span className={cn('truncate font-medium', compact ? 'text-[10px]' : 'text-[11px]')}>
            {name}
          </span>
        </div>
      </div>

      {/* Role chip — góc trên-phải, chỉ mod, không compact */}
      {isMod && !compact && (
        <span className="absolute right-2 top-2 rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 backdrop-blur">
          {role === 'OWNER' ? 'Owner' : role === 'ADMIN' ? 'Admin' : 'Mod'}
        </span>
      )}

      {/* Badge giơ tay ✋ — góc trên-trái, nhún nhẹ; tự hạ sau TTL */}
      {raised && (
        <span
          title="Đang giơ tay"
          className={cn(
            'absolute left-2 top-2 z-10 inline-flex animate-bounce items-center justify-center rounded-full bg-amber-400 text-amber-950 shadow ring-2 ring-amber-200/70',
            compact ? 'h-5 w-5' : 'h-7 w-7',
          )}
        >
          <Hand className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
        </span>
      )}
    </div>
  );
}
