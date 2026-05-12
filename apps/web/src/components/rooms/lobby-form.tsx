/**
 * LobbyForm — preview cam/mic + nhập display name trước khi join room.
 *
 * Phase 13 v1: tự build (không dùng LiveKit's PreJoin) để giữ styling thống nhất.
 * - Preview cam dùng getUserMedia trực tiếp.
 * - Toggle mic/cam ON/OFF — lưu prefs vào localStorage để next session reuse.
 * - Click "Vào phòng" → navigate /rooms/{id} (main room fetch token + connect).
 *
 * Permission flow:
 *   - Khi mount, requestMedia({video, audio}) — browser prompt user.
 *   - User deny → hiển thị message "Bật quyền mic/cam trong settings".
 *   - getUserMedia trả null nếu deny — render nút "Thử lại".
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, MicOff, Video, VideoOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

type Props = {
  roomId: string;
  roomName: string;
  defaultDisplayName: string;
};

export function LobbyForm({ roomId, roomName, defaultDisplayName }: Props) {
  const router = useRouter();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const [displayName, setDisplayName] = React.useState(defaultDisplayName);
  const [micOn, setMicOn] = React.useState(true);
  const [camOn, setCamOn] = React.useState(true);
  const [permState, setPermState] = React.useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [joining, setJoining] = React.useState(false);

  // Request media khi mount + cleanup khi unmount
  React.useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPermState('granted');
        // Restore prefs
        const savedMic = localStorage.getItem('room.micOn');
        const savedCam = localStorage.getItem('room.camOn');
        if (savedMic === 'false') { setMicOn(false); stream.getAudioTracks().forEach(t => (t.enabled = false)); }
        if (savedCam === 'false') { setCamOn(false); stream.getVideoTracks().forEach(t => (t.enabled = false)); }
      } catch (err) {
        console.error('[lobby] getUserMedia fail:', err);
        setPermState('denied');
      }
    }
    init();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    localStorage.setItem('room.micOn', String(next));
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  };

  const toggleCam = () => {
    const next = !camOn;
    setCamOn(next);
    localStorage.setItem('room.camOn', String(next));
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  };

  const join = () => {
    if (!displayName.trim()) return;
    setJoining(true);
    // Lưu display name + prefs để main room đọc lại
    localStorage.setItem('room.displayName', displayName.trim());
    localStorage.setItem('room.micOn', String(micOn));
    localStorage.setItem('room.camOn', String(camOn));
    // Stop preview stream — main room sẽ tạo stream mới qua LiveKit SDK
    streamRef.current?.getTracks().forEach((t) => t.stop());
    router.push(`/rooms/${roomId}`);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      {/* ── Preview ─────────────────────────── */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-900">
        {permState === 'denied' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-300">
            <VideoOff className="h-10 w-10" />
            <p className="font-medium">Không truy cập được mic/camera</p>
            <p className="text-sm text-slate-400">
              Bật quyền trong settings của trình duyệt rồi reload trang.
            </p>
          </div>
        ) : !camOn ? (
          <div className="flex h-full items-center justify-center text-slate-400">
            <VideoOff className="h-10 w-10" />
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        )}

        {/* Overlay controls bottom */}
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2">
          <Button
            onClick={toggleMic}
            variant={micOn ? 'secondary' : 'destructive'}
            size="icon"
            aria-label={micOn ? 'Tắt mic' : 'Bật mic'}
            disabled={permState !== 'granted'}
          >
            {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </Button>
          <Button
            onClick={toggleCam}
            variant={camOn ? 'secondary' : 'destructive'}
            size="icon"
            aria-label={camOn ? 'Tắt cam' : 'Bật cam'}
            disabled={permState !== 'granted'}
          >
            {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* ── Form ───────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold">{roomName}</h2>
          <p className="text-sm text-muted-foreground">Sẵn sàng tham gia?</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dn">Tên hiển thị</Label>
          <input
            id="dn"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Tên của bạn"
            maxLength={50}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <Button onClick={join} disabled={joining || !displayName.trim()} size="lg" className="mt-auto">
          {joining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Vào phòng
        </Button>
        <p className="text-xs text-muted-foreground">
          Nhấn M để tắt/bật mic, C để tắt/bật cam khi vào phòng.
        </p>
      </div>
    </div>
  );
}
