/**
 * VoiceStateSync — silent child component bên trong LiveKitRoom.
 *
 * Subscribe local participant track events (mic / cam / screen publish-unpublish
 * + mute-unmute) → 2 path đồng thời:
 *   1. **Optimistic local broadcast** qua `window` CustomEvent
 *      `cogniva:voice-state` — VoiceChannelMembers (cùng tab) nhận INSTANT,
 *      0ms latency. Dùng cho own user trên sidebar trái.
 *   2. **Server sync**: POST `/voice/state` → UPSERT DB → emit realtime
 *      `voice:state-changed` cho remote users (tab khác / user khác).
 *
 * Tại sao 2 path: roundtrip realtime 100-500ms gây lag UI khi user tự toggle.
 * Local event giải quyết — server vẫn ground truth cho remote sync.
 */
'use client';

import * as React from 'react';
import {
  useLocalParticipant,
} from '@livekit/components-react';
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
      // selfMuted: mic publication không tồn tại HOẶC isMuted = true
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
      const selfMuted = !micPub || micPub.isMuted;
      // camera/screen: publication tồn tại + không muted (LiveKit thường
      // unpublish khi user toggle off → publication biến mất)
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

      // Path 1: optimistic local broadcast — TỨC THÌ mỗi lần (own UI 0ms latency).
      const detail: VoiceStateEventDetail = {
        channelId,
        userId: currentUserId,
        ...state,
      };
      window.dispatchEvent(new CustomEvent(VOICE_STATE_EVENT, { detail }));

      // Path 2: server sync — DEBOUNCE 300ms. Toggle mic/cam/share liên tục chỉ POST trạng
      // thái CUỐI → 1 broadcast realtime (remote không flicker/sai thứ tự + đỡ flood server).
      if (postTimer) clearTimeout(postTimer);
      postTimer = setTimeout(() => {
        if (cancelled) return;
        fetch(`/api/channels/${channelId}/voice/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(computeState()), // đọc trạng thái MỚI NHẤT lúc fire
        }).catch(() => {
          /* ignore — best-effort */
        });
      }, 300);
    };

    // Initial sync — POST ngay khi mount + retry 1s sau (LiveKit có thể
    // chưa publish track ngay lúc mount).
    const t1 = setTimeout(sync, 100);
    const t2 = setTimeout(sync, 1500);

    // Bind track events trên local participant — fire khi user toggle.
    //
    // QUAN TRỌNG: local participant phát 'localTrackPublished'/'localTrackUnpublished'
    // khi CHÍNH MÌNH publish/unpublish (bật cam, share màn hình). 'trackPublished'/
    // 'trackUnpublished' chỉ cho REMOTE → bind nhầm khiến bật cam/share KHÔNG
    // fire sync → sidebar không update cho tới khi có event khác (mic mute) hoặc
    // timer 1.5s chạy lại sync. Phải bind CẢ biến thể Local* mới đúng.
    // (mic mute/unmute vẫn fire 'trackMuted'/'trackUnmuted' nên trước đây vẫn ok)
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
