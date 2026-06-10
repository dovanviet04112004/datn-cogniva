/**
 * ControlBar — thanh điều khiển dưới cùng của room.
 *
 * Buttons:
 *   - Mic toggle    (M shortcut)
 *   - Camera toggle (C shortcut)
 *   - Screen share toggle
 *   - Raise hand    (publish data channel — Phase 14 sẽ render queue)
 *   - Leave (destructive)
 *
 * Phase 13 v1: chỉ buttons cơ bản. Phase 14 sẽ thêm:
 *   - DeviceSettings modal (đổi mic/cam giữa session)
 *   - ReactionPicker (emoji float)
 *   - RecordButton (mod only, Phase 15)
 */
'use client';

import * as React from 'react';
import { useTrackToggle, useRoomContext } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Hand, LogOut, Mic, MicOff, ScreenShare, Video, VideoOff } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ReactionPicker } from './reaction-picker';
import { RecordButton } from './record-button';

type Props = {
  /** Callback khi user click Leave — parent xử lý disconnect + navigate. */
  onLeave: () => void;
  /** ID room — cần cho Record button gọi API. */
  roomId: string;
  /** True khi user là OWNER/MODERATOR — chỉ mod thấy Record button. */
  isMod: boolean;
};

export function ControlBar({ onLeave, roomId, isMod }: Props) {
  const room = useRoomContext();
  const { toggle: toggleMic, enabled: micOn } = useTrackToggle({ source: Track.Source.Microphone });
  const { toggle: toggleCam, enabled: camOn } = useTrackToggle({ source: Track.Source.Camera });
  const { toggle: toggleScreen, enabled: screenOn } = useTrackToggle({ source: Track.Source.ScreenShare });

  // Keyboard shortcuts: M = mic, C = cam (chỉ khi không focus input)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key.toLowerCase() === 'm') toggleMic();
      else if (e.key.toLowerCase() === 'c') toggleCam();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleMic, toggleCam]);

  /** Publish data event RAISE_HAND tới tất cả participant. */
  const raiseHand = async () => {
    try {
      const payload = new TextEncoder().encode(JSON.stringify({ type: 'RAISE_HAND', at: Date.now() }));
      await room.localParticipant.publishData(payload, { reliable: true });
      toast.success('Đã giơ tay');
    } catch (err) {
      toast.error('Gửi tín hiệu thất bại');
      console.error(err);
    }
  };

  return (
    <div className="glass-elevated flex items-center justify-center gap-2 border-t border-divider p-3">
      <Button
        onClick={() => toggleMic()}
        variant={micOn ? 'secondary' : 'destructive'}
        size="icon"
        aria-label={micOn ? 'Tắt mic (M)' : 'Bật mic (M)'}
        title={micOn ? 'Tắt mic (M)' : 'Bật mic (M)'}
      >
        {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </Button>

      <Button
        onClick={() => toggleCam()}
        variant={camOn ? 'secondary' : 'destructive'}
        size="icon"
        aria-label={camOn ? 'Tắt cam (C)' : 'Bật cam (C)'}
        title={camOn ? 'Tắt cam (C)' : 'Bật cam (C)'}
      >
        {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      </Button>

      <Button
        onClick={() => toggleScreen()}
        variant={screenOn ? 'default' : 'secondary'}
        size="icon"
        aria-label="Chia sẻ màn hình"
        title="Chia sẻ màn hình"
      >
        <ScreenShare className="h-4 w-4" />
      </Button>

      <Button
        onClick={raiseHand}
        variant="secondary"
        size="icon"
        aria-label="Giơ tay"
        title="Giơ tay (gửi tín hiệu cho mod)"
      >
        <Hand className="h-4 w-4" />
      </Button>

      <ReactionPicker />

      <RecordButton roomId={roomId} visible={isMod} />

      <div className="w-4" />

      <Button onClick={onLeave} variant="destructive" size="icon" aria-label="Rời phòng" title="Rời phòng">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
