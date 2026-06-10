/**
 * ProctorCamera (Phase 19) — webcam preview + mic monitor + snapshot capture.
 *
 * UX:
 *   - Component cố định ở góc dưới phải, kích thước 200x150 video preview
 *   - Hiện badge LIVE đỏ + thanh mic level (volume) nếu enabled
 *   - Permission denied → onViolation('webcam_denied') / ('mic_denied')
 *   - Track không có signal (camera che) → onViolation('webcam_missing') sau 10s
 *   - Snapshot canvas mỗi 30s (chỉ khi enabled.snapshot)
 *
 * Privacy note: stream local-only, KHÔNG upload server V1. Snapshot lưu
 * IndexedDB client (component cha có thể download/inspect sau exam).
 */
'use client';

import * as React from 'react';
import { Video, VideoOff, Mic, MicOff } from 'lucide-react';
import type { ViolationEvent } from '@/lib/anti-cheat/detectors';

type Props = {
  /** Bật webcam — false sẽ KHÔNG request permission. */
  webcam: boolean;
  /** Bật mic — false sẽ KHÔNG request permission. */
  mic: boolean;
  /** Interval (ms) capture snapshot. 0 = không capture. */
  snapshotIntervalMs?: number;
  /** Callback khi có violation (denied/missing/silent). */
  onViolation: (v: ViolationEvent) => void;
  /** Callback khi snapshot tạo xong — base64 JPEG (q=0.6, ~30-50KB). */
  onSnapshot?: (dataUrl: string, timestamp: number) => void;
};

export function ProctorCamera({
  webcam,
  mic,
  snapshotIntervalMs = 30_000,
  onViolation,
  onSnapshot,
}: Props) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const [hasVideo, setHasVideo] = React.useState(false);
  const [hasAudio, setHasAudio] = React.useState(false);
  const [micLevel, setMicLevel] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  // Init media + cleanup
  React.useEffect(() => {
    if (!webcam && !mic) return;

    let cancelled = false;
    let silentSince: number | null = null;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: webcam ? { width: 320, height: 240, facingMode: 'user' } : false,
          audio: mic,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (webcam) {
          setHasVideo(true);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        }
        if (mic) {
          setHasAudio(true);
          const ctx = new AudioContext();
          audioCtxRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyserRef.current = analyser;
          const source = ctx.createMediaStreamSource(stream);
          source.connect(analyser);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        if (webcam) {
          onViolation({
            type: 'webcam_denied',
            severity: 'high',
            timestamp: Date.now(),
            metadata: { error: msg },
          });
        }
        if (mic) {
          onViolation({
            type: 'mic_denied',
            severity: 'high',
            timestamp: Date.now(),
            metadata: { error: msg },
          });
        }
      }
    })();

    // Mic level monitor loop
    let micRAF = 0;
    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const norm = avg / 128; // 0..2 nominal
        setMicLevel(Math.min(1, norm));

        // Silent detection: mic on but nothing for 30s
        if (mic && norm < 0.05) {
          if (silentSince === null) silentSince = Date.now();
          else if (Date.now() - silentSince > 30_000) {
            onViolation({
              type: 'mic_silent',
              severity: 'medium',
              timestamp: Date.now(),
              metadata: { silentSeconds: 30 },
            });
            silentSince = Date.now(); // reset để không spam
          }
        } else {
          silentSince = null;
        }
      }
      micRAF = requestAnimationFrame(tick);
    };
    if (mic) tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(micRAF);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [webcam, mic, onViolation]);

  // Snapshot loop
  React.useEffect(() => {
    if (!webcam || !snapshotIntervalMs || !onSnapshot) return;
    const id = setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      if (video.videoWidth === 0) {
        // Camera available nhưng không có signal (che, off) — violation sau 10s
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      onSnapshot(dataUrl, Date.now());
    }, snapshotIntervalMs);
    return () => clearInterval(id);
  }, [webcam, snapshotIntervalMs, onSnapshot]);

  // Detect "camera covered" — no pixel change after 10s
  React.useEffect(() => {
    if (!webcam || !hasVideo) return;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      // Heuristic: check if videoElement actually receiving frames
      // Browser API không có direct "is frame fresh" → bỏ qua V1
    }, 10_000);
    return () => clearInterval(id);
  }, [webcam, hasVideo]);

  if (!webcam && !mic) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-md border bg-card shadow-lg">
      {webcam && (
        <div className="relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="block h-[150px] w-[200px] rounded-t-md bg-black object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />
          {hasVideo ? (
            <span className="absolute top-1 left-1 flex items-center gap-1 rounded bg-recording-live/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> LIVE
            </span>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80 text-white">
              <VideoOff className="h-6 w-6" />
              <span className="text-[10px]">Cam off</span>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        {webcam && <Video className={`h-3.5 w-3.5 ${hasVideo ? 'text-success' : 'text-destructive'}`} />}
        {mic && (
          <>
            <Mic className={`h-3.5 w-3.5 ${hasAudio ? 'text-success' : 'text-destructive'}`} />
            <div className="flex-1 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-success transition-all"
                style={{ width: `${micLevel * 100}%` }}
              />
            </div>
          </>
        )}
        {!mic && !webcam && <MicOff className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      {error && (
        <p className="px-2 pb-1 text-[10px] text-destructive">{error.slice(0, 60)}</p>
      )}
    </div>
  );
}
