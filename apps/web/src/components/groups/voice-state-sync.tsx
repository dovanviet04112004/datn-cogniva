'use client';

import * as React from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';

export const VOICE_STATE_EVENT = 'cogniva:voice-state';

export type VoiceStateEventDetail = {
  channelId: string;
  userId: string;
  selfMuted: boolean;
  camera: boolean;
  screenShare: boolean;
};

export function VoiceStateSync({
  channelId,
  currentUserId,
}: {
  channelId: string;
  currentUserId: string;
}) {
  const { localParticipant } = useLocalParticipant();

  React.useEffect(() => {
    if (!localParticipant) return;
    let cancelled = false;

    const computeState = () => {
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
      const selfMuted = !micPub || micPub.isMuted;
      const camPub = localParticipant.getTrackPublication(Track.Source.Camera);
      const camera = !!camPub && !camPub.isMuted;
      const screenPub = localParticipant.getTrackPublication(Track.Source.ScreenShare);
      const screenShare = !!screenPub && !screenPub.isMuted;
      return { selfMuted, camera, screenShare };
    };

    let postTimer: ReturnType<typeof setTimeout> | null = null;

    const sync = () => {
      if (cancelled) return;
      const state = computeState();

      const detail: VoiceStateEventDetail = {
        channelId,
        userId: currentUserId,
        ...state,
      };
      window.dispatchEvent(new CustomEvent(VOICE_STATE_EVENT, { detail }));

      if (postTimer) clearTimeout(postTimer);
      postTimer = setTimeout(() => {
        if (cancelled) return;
        fetch(`/api/channels/${channelId}/voice/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(computeState()),
        }).catch(() => {});
      }, 300);
    };

    const t1 = setTimeout(sync, 100);
    const t2 = setTimeout(sync, 1500);

    const events = [
      'localTrackPublished',
      'localTrackUnpublished',
      'trackPublished',
      'trackUnpublished',
      'trackMuted',
      'trackUnmuted',
    ] as const;
    for (const ev of events) {
      localParticipant.on(ev, sync);
    }

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      if (postTimer) clearTimeout(postTimer);
      for (const ev of events) {
        localParticipant.off(ev, sync);
      }
    };
  }, [localParticipant, channelId, currentUserId]);

  return null;
}
