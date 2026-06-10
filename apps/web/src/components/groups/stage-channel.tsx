/**
 * StageChannel — Discord Stage-style channel render cho study group.
 *
 * Khác VoiceChannel:
 *   - Audience không thấy mic/cam toggle (canPublish=false LiveKit grant).
 *   - Stage area trên: chỉ render Speaker (role=SPEAKER hoặc mod) — tile lớn.
 *   - Audience area dưới: avatar nhỏ grid + nút raise hand.
 *   - Mod thấy raised-hands queue + nút Promote/Demote.
 *
 * Realtime sync qua Socket.IO `presence-voice-{channelId}`:
 *   - stage:hand     → audience raise/lower hand
 *   - stage:promoted → audience → speaker (refetch state)
 *   - stage:demoted  → speaker → audience
 */
'use client';

import * as React from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useIsSpeaking,
  useTracks,
  TrackRefContext,
  VideoTrack,
  useTrackToggle,
} from '@livekit/components-react';
import { Track, type Participant } from 'livekit-client';
import { Hand, Loader2, LogOut, Mic, MicOff, Radio, UserCheck, UserMinus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRealtimeEvent } from '@/lib/realtime-client';
import type { StudyGroupChannel } from '@cogniva/db';

type Props = {
  channel: StudyGroupChannel;
  myRole: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  currentUserId: string;
  currentUserName: string;
  currentUserImage: string | null;
};

type TokenResponse = {
  token: string;
  url: string;
  channel: { id: string; name: string; livekitRoomName: string; type: string };
  isMod: boolean;
  stageRole: 'AUDIENCE' | 'SPEAKER' | null;
};

type StageState = {
  mySelf: { role: 'AUDIENCE' | 'SPEAKER' | 'MOD'; raised: boolean };
  speakers: Array<{ userId: string; name: string | null; image: string | null; promotedAt: string | null }>;
  raisedHands: Array<{ userId: string; name: string | null; image: string | null; raisedAt: string }>;
  isMod: boolean;
};

export function StageChannel({
  channel,
  myRole,
  currentUserId,
  currentUserImage,
}: Props) {
  const [auth, setAuth] = React.useState<TokenResponse | null>(null);
  const [connecting, setConnecting] = React.useState(false);

  const join = async () => {
    setConnecting(true);
    try {
      const res = await fetch(`/api/channels/${channel.id}/voice/token`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `status ${res.status}`);
      }
      const data: TokenResponse = await res.json();
      setAuth(data);
    } catch (err) {
      toast.error('Vào stage thất bại: ' + (err as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const leave = async () => {
    setAuth(null);
    fetch(`/api/channels/${channel.id}/voice/leave`, { method: 'POST' }).catch(() => {});
  };

  if (!auth) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b pl-12 pr-12 md:pl-4 md:pr-4 lg:pr-14">
          <Radio className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="truncate font-semibold">{channel.name}</span>
          {channel.topic && (
            <>
              <span className="hidden h-4 w-px bg-border sm:block" />
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                {channel.topic}
              </span>
            </>
          )}
        </header>
        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 p-6 dark:from-slate-950 dark:via-amber-950/30 dark:to-slate-950">
          <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-rose-500/20 blur-3xl" />
          <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-white/20 bg-white/70 p-8 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-rose-500 text-white shadow-lg">
              <Radio className="h-8 w-8" />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-bold">#{channel.name}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Stage channel — audience nghe, speaker nói. Mod promote audience lên speaker khi raise hand.
              </p>
            </div>
            {/* "Vào stage" — GIỮ accent stage (có chủ đích, phân biệt với voice/primary),
                đổi gradient amber/rose → token bg-stage-host cho nhất quán design system. */}
            <Button
              onClick={join}
              disabled={connecting}
              size="lg"
              className="w-full bg-stage-host text-white shadow-md hover:bg-stage-host/90"
            >
              {connecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Đang kết nối...
                </>
              ) : (
                <>
                  <Radio className="mr-2 h-4 w-4" />
                  Vào stage
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const localMeta = { [currentUserId]: { avatar: currentUserImage, role: myRole } };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b pl-12 pr-12 md:px-4 lg:pr-4">
        <Radio className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="truncate font-semibold">{channel.name}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-green-600 sm:inline">● Đã kết nối</span>
        </span>
      </header>
      <div className="min-h-0 flex-1">
        <LiveKitRoom
          token={auth.token}
          serverUrl={auth.url}
          connect={true}
          video={false}
          audio={auth.stageRole === 'SPEAKER' || auth.isMod}
          onDisconnected={leave}
          options={{ adaptiveStream: true, dynacast: true }}
          className="flex h-full flex-col"
        >
          <StageInner
            channelId={channel.id}
            isMod={auth.isMod}
            stageRole={auth.stageRole}
            currentUserId={currentUserId}
            participantMeta={localMeta}
            onLeave={leave}
          />
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
    </div>
  );
}

type StageInnerProps = {
  channelId: string;
  isMod: boolean;
  stageRole: 'AUDIENCE' | 'SPEAKER' | null;
  currentUserId: string;
  participantMeta: Record<string, { avatar?: string | null; role?: string }>;
  onLeave: () => void;
};

function StageInner({ channelId, isMod, stageRole, currentUserId, participantMeta, onLeave }: StageInnerProps) {
  const [state, setState] = React.useState<StageState | null>(null);
  const participants = useParticipants();

  const refresh = React.useCallback(() => {
    fetch(`/api/channels/${channelId}/stage`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d: StageState) => setState(d))
      .catch(() => {});
  }, [channelId]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime sync — stage:hand/promoted/demoted → refresh state.
  const stageChannel = `presence-voice-${channelId}`;
  useRealtimeEvent(stageChannel, 'stage:hand', refresh);
  useRealtimeEvent(stageChannel, 'stage:promoted', refresh);
  useRealtimeEvent(stageChannel, 'stage:demoted', refresh);

  // Safety net polling 30s — realtime event đảm nhiệm realtime, polling chỉ
  // phòng trường hợp event miss (network blip, realtime outage tạm).
  React.useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Map identity → metadata để render speaker tile
  const speakerIds = new Set([
    ...(state?.speakers.map((s) => s.userId) ?? []),
    // Mod participants luôn ở stage (canPublish=true)
    ...participants
      .filter((p) => {
        try {
          const md = p.metadata ? JSON.parse(p.metadata) : null;
          return md?.groupRole && ['OWNER', 'ADMIN', 'MODERATOR'].includes(md.groupRole);
        } catch {
          return false;
        }
      })
      .map((p) => p.identity),
  ]);
  const speakerParticipants = participants.filter((p) => speakerIds.has(p.identity));
  const audienceParticipants = participants.filter((p) => !speakerIds.has(p.identity));

  return (
    <div className="flex h-full flex-col bg-gradient-to-br from-slate-950 via-amber-950/30 to-slate-950">
      {/* Stage area — speakers */}
      <section className="border-b border-white/10 px-4 py-4 sm:px-6">
        <div className="mb-3 flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-amber-500" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
            Trên stage ({speakerParticipants.length})
          </h3>
        </div>
        {speakerParticipants.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chưa có speaker. Mod cần lên hoặc promote audience.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {speakerParticipants.map((p) => (
              <SpeakerTile
                key={p.identity}
                participant={p}
                meta={participantMeta[p.identity]}
                isMod={isMod}
                onDemote={async () => {
                  await fetch(`/api/channels/${channelId}/stage/demote/${p.identity}`, {
                    method: 'POST',
                  });
                  refresh();
                }}
                isSelf={p.identity === currentUserId}
              />
            ))}
          </div>
        )}
      </section>

      {/* Mod: raised hands queue */}
      {isMod && state && state.raisedHands.length > 0 && (
        <section className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-3 sm:px-6">
          <div className="mb-2 flex items-center gap-2">
            <Hand className="h-3.5 w-3.5 text-amber-500" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              Đang giơ tay ({state.raisedHands.length})
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {state.raisedHands.map((r) => (
              <button
                key={r.userId}
                onClick={async () => {
                  await fetch(`/api/channels/${channelId}/stage/promote/${r.userId}`, {
                    method: 'POST',
                  });
                  refresh();
                }}
                className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 transition hover:bg-amber-500/20"
                title="Promote lên speaker"
              >
                {r.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image} alt={r.name ?? ''} className="h-5 w-5 rounded-full object-cover" />
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/30 text-[10px] font-bold">
                    {(r.name ?? '?')[0]?.toUpperCase()}
                  </span>
                )}
                <span className="font-medium">{r.name ?? 'Anonymous'}</span>
                <UserCheck className="h-3 w-3" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Audience area */}
      <section className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Khán giả ({audienceParticipants.length})
          </h3>
        </div>
        {audienceParticipants.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Chưa có khán giả.</p>
        ) : (
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
            {audienceParticipants.map((p) => (
              <AudienceTile
                key={p.identity}
                participant={p}
                meta={participantMeta[p.identity]}
                isHandRaised={
                  state?.raisedHands.some((r) => r.userId === p.identity) ?? false
                }
                isMod={isMod}
                onPromote={async () => {
                  await fetch(`/api/channels/${channelId}/stage/promote/${p.identity}`, {
                    method: 'POST',
                  });
                  refresh();
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Bottom bar — audience raise hand / speaker mic toggle / demote self / leave */}
      <StageControlBar
        channelId={channelId}
        currentUserId={currentUserId}
        isMod={isMod}
        stageRole={stageRole}
        currentRaised={state?.mySelf.raised ?? false}
        currentRole={state?.mySelf.role ?? 'AUDIENCE'}
        onAction={refresh}
        onLeave={onLeave}
      />
    </div>
  );
}

function SpeakerTile({
  participant,
  meta,
  isMod,
  onDemote,
  isSelf,
}: {
  participant: Participant;
  meta?: { avatar?: string | null; role?: string };
  isMod: boolean;
  onDemote: () => void;
  isSelf: boolean;
}) {
  const speaking = useIsSpeaking(participant);
  const name = participant.name ?? participant.identity;
  const initials = (name || '?').slice(0, 2).toUpperCase();
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const micOn = micPub && !micPub.isMuted;
  const camTrack = useTracks([Track.Source.Camera], { onlySubscribed: true }).find(
    (t) => t.participant.identity === participant.identity,
  );
  const avatarUrl = meta?.avatar;

  return (
    <div
      className={cn(
        'group relative aspect-square overflow-hidden rounded-xl border bg-slate-900/60 backdrop-blur-sm transition-all',
        speaking
          ? 'border-emerald-400/80 shadow-[0_0_24px_rgba(52,211,153,0.5)]'
          : 'border-amber-500/30',
      )}
    >
      {camTrack && !camTrack.publication?.isMuted ? (
        <TrackRefContext.Provider value={camTrack}>
          <VideoTrack
            trackRef={camTrack}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </TrackRefContext.Provider>
      ) : (
        <div className="flex h-full items-center justify-center">
          <div
            className={cn(
              'flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-amber-500 to-rose-500 text-2xl font-semibold text-white shadow-lg ring-4 transition-all',
              speaking ? 'ring-emerald-400/70' : 'ring-amber-500/20',
            )}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
            ) : (
              <span>{initials}</span>
            )}
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 py-1.5">
        <span
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
            micOn ? 'bg-voice-active/80' : 'bg-voice-mute/80',
          )}
        >
          {micOn ? <Mic className="h-2.5 w-2.5 text-white" /> : <MicOff className="h-2.5 w-2.5 text-white" />}
        </span>
        <span className="truncate text-xs font-medium text-white">{name}</span>
        {(isMod || isSelf) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDemote();
            }}
            className="ml-auto rounded p-0.5 text-white/70 opacity-0 hover:bg-red-500/30 hover:text-red-300 group-hover:opacity-100"
            title={isSelf ? 'Rời stage' : 'Demote'}
          >
            <UserMinus className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function AudienceTile({
  participant,
  meta,
  isHandRaised,
  isMod,
  onPromote,
}: {
  participant: Participant;
  meta?: { avatar?: string | null };
  isHandRaised: boolean;
  isMod: boolean;
  onPromote: () => void;
}) {
  const name = participant.name ?? participant.identity;
  const initials = (name || '?').slice(0, 2).toUpperCase();
  const avatarUrl = meta?.avatar;

  return (
    <div className="group relative flex flex-col items-center gap-1">
      <div className="relative h-12 w-12 sm:h-14 sm:w-14">
        <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-slate-700 text-sm font-semibold text-white">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <span>{initials}</span>
          )}
        </div>
        {isHandRaised && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] shadow-lg ring-2 ring-slate-950">
            <Hand className="h-2.5 w-2.5 text-white" />
          </span>
        )}
        {isMod && isHandRaised && (
          <button
            onClick={onPromote}
            className="absolute inset-0 flex items-center justify-center rounded-full bg-amber-500/80 text-white opacity-0 transition group-hover:opacity-100"
            title="Promote"
          >
            <UserCheck className="h-4 w-4" />
          </button>
        )}
      </div>
      <span className="max-w-[60px] truncate text-[10px] text-muted-foreground sm:max-w-[80px]">
        {name}
      </span>
    </div>
  );
}

function StageControlBar({
  channelId,
  currentUserId,
  isMod,
  stageRole,
  currentRaised,
  currentRole,
  onAction,
  onLeave,
}: {
  channelId: string;
  currentUserId: string;
  isMod: boolean;
  stageRole: 'AUDIENCE' | 'SPEAKER' | null;
  currentRaised: boolean;
  currentRole: 'AUDIENCE' | 'SPEAKER' | 'MOD';
  onAction: () => void;
  onLeave: () => void;
}) {
  // Speaker/Mod có quyền publish → render mic toggle
  const canPublish = isMod || currentRole === 'SPEAKER' || stageRole === 'SPEAKER';

  const { toggle: toggleMic, enabled: micOn } = useTrackToggle({
    source: Track.Source.Microphone,
  });

  const raiseHand = async () => {
    const res = await fetch(`/api/channels/${channelId}/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: currentRaised ? 'lower' : 'raise' }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error('Raise hand fail: ' + (d?.error ?? `status ${res.status}`));
      return;
    }
    onAction();
  };

  return (
    <div className="flex items-center justify-center gap-2 border-t border-white/10 bg-slate-950/80 px-3 py-3 backdrop-blur-md">
      {canPublish && (
        <Button
          onClick={() => toggleMic()}
          size="sm"
          className={cn(
            'h-9 w-9 p-0',
            micOn
              ? 'bg-white/10 text-white hover:bg-white/20'
              : 'bg-red-500/90 text-white hover:bg-red-600',
          )}
          aria-label={micOn ? 'Tắt mic' : 'Bật mic'}
        >
          {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </Button>
      )}

      {!isMod && currentRole === 'AUDIENCE' && (
        <Button
          onClick={raiseHand}
          size="sm"
          className={cn(
            'h-9 gap-1.5 px-3',
            currentRaised
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'bg-white/10 text-white hover:bg-white/20',
          )}
        >
          <Hand className="h-4 w-4" />
          <span className="text-xs">{currentRaised ? 'Hạ tay' : 'Giơ tay'}</span>
        </Button>
      )}

      {currentRole === 'SPEAKER' && !isMod && (
        <Button
          onClick={async () => {
            await fetch(`/api/channels/${channelId}/stage/demote/${currentUserId}`, {
              method: 'POST',
            });
            onAction();
          }}
          size="sm"
          className="h-9 gap-1.5 bg-white/10 px-3 text-white hover:bg-white/20"
        >
          <UserMinus className="h-4 w-4" />
          <span className="text-xs">Rời stage</span>
        </Button>
      )}

      <div className="mx-1 h-8 w-px bg-white/10" />

      <Button
        onClick={onLeave}
        size="sm"
        className="h-9 gap-1.5 bg-red-600 px-3 hover:bg-red-700"
        aria-label="Rời channel"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden text-xs sm:inline">Rời</span>
      </Button>
    </div>
  );
}
