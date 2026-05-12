/**
 * VideoGrid — render lưới video tự co dãn theo số participant.
 *
 * Layout adaptive:
 *   1 người      → 1 cột full
 *   2-4 người    → 2 cột
 *   5-9 người    → 3 cột
 *   10-16 người  → 4 cột
 *   17+ người    → 5 cột
 *
 * Track sources: camera (mặc định) + screenshare (nếu có) — render trộn
 * cùng grid. `withPlaceholder: true` cho camera để khi tắt cam vẫn thấy
 * avatar/name (UX tốt hơn ô đen trơn).
 */
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
  const cols = count <= 1 ? 1
             : count <= 4 ? 2
             : count <= 9 ? 3
             : count <= 16 ? 4
             : 5;

  if (count === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-900 text-slate-400">
        <p className="text-sm">Đang kết nối...</p>
      </div>
    );
  }

  return (
    <div
      className="flex-1 grid gap-2 p-4 bg-slate-900"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {tracks.map((t) => (
        <ParticipantTile
          key={t.publication?.trackSid ?? t.participant.identity}
          trackRef={t}
          className="rounded-lg overflow-hidden bg-black"
        />
      ))}
    </div>
  );
}
