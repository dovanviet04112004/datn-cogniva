'use client';

import * as React from 'react';
import { VideoTrack, useLocalParticipant, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Maximize2, Mic, MicOff, PhoneOff, PictureInPicture2, Video, VideoOff } from 'lucide-react';

export function VoiceMiniContent({
  channelName,
  onLeave,
  onReturn,
  onPiP,
}: {
  channelName: string;
  onLeave: () => void;
  onReturn: () => void;
  onPiP?: () => void;
}) {
  const { localParticipant } = useLocalParticipant();
  const micOn = localParticipant?.isMicrophoneEnabled ?? false;
  const camOn = localParticipant?.isCameraEnabled ?? false;

  const tracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera], {
    onlySubscribed: false,
  });
  const videoTrack = tracks.find(
    (t) => t.publication && !t.publication.isMuted && t.publication.track,
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-900 text-white">
      <div className="relative min-h-0 flex-1">
        {videoTrack ? (
          <VideoTrack trackRef={videoTrack} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-900 via-slate-900 to-purple-900">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-2xl backdrop-blur">
              🎧
            </div>
          </div>
        )}
        <span className="absolute left-2 top-2 max-w-[75%] truncate rounded-md bg-black/50 px-2 py-0.5 text-[12px] font-medium backdrop-blur">
          🔊 {channelName}
        </span>
      </div>

      <div className="flex items-center justify-center gap-1.5 bg-slate-950/90 p-2">
        <MiniBtn
          active={micOn}
          onClick={() => localParticipant?.setMicrophoneEnabled(!micOn)}
          label={micOn ? 'Tắt mic' : 'Bật mic'}
        >
          {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </MiniBtn>
        <MiniBtn
          active={camOn}
          onClick={() => localParticipant?.setCameraEnabled(!camOn)}
          label={camOn ? 'Tắt cam' : 'Bật cam'}
        >
          {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </MiniBtn>
        {onPiP && (
          <MiniBtn onClick={onPiP} label="Cửa sổ nổi (ra ngoài tab/app)">
            <PictureInPicture2 className="h-4 w-4" />
          </MiniBtn>
        )}
        <MiniBtn onClick={onReturn} label="Về phòng đầy đủ">
          <Maximize2 className="h-4 w-4" />
        </MiniBtn>
        <button
          type="button"
          onClick={onLeave}
          aria-label="Rời voice"
          title="Rời voice"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function MiniBtn({
  active = true,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        'inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ' +
        (active
          ? 'bg-white/15 text-white hover:bg-white/25'
          : 'bg-amber-500/25 text-amber-300 hover:bg-amber-500/35')
      }
    >
      {children}
    </button>
  );
}

export function VoicePiPView(props: {
  channelName: string;
  onLeave: () => void;
  onReturn: () => void;
}) {
  return (
    <div className="h-screen w-screen">
      <VoiceMiniContent {...props} />
    </div>
  );
}
