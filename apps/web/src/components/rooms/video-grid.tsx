'use client';

import { ParticipantTile, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';

export function VideoGrid() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const count = tracks.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : count <= 16 ? 4 : 5;

  if (count === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-900 text-slate-400">
        <p className="text-sm">Đang kết nối...</p>
      </div>
    );
  }

  return (
    <div
      className="grid flex-1 gap-2 bg-slate-900 p-4"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {tracks.map((t) => (
        <ParticipantTile
          key={t.publication?.trackSid ?? t.participant.identity}
          trackRef={t}
          className="overflow-hidden rounded-lg bg-black"
        />
      ))}
    </div>
  );
}
