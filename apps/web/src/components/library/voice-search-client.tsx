/**
 * VoiceSearchClient — Phase 5 (2026-05-27).
 *
 * Web demo client cho /api/library/voice-search. Flow:
 *   1. Click "Start recording" → MediaRecorder thu âm webm/ogg
 *   2. Click "Stop" → upload Blob qua FormData → backend transcribe + search
 *   3. Render transcript + top hits với link tới doc detail
 *
 * Lưu ý:
 *   - MediaRecorder chỉ chạy client (HTTPS bắt buộc trên prod).
 *   - Browser tự chọn mime type tốt nhất (Chrome: audio/webm, Safari: audio/mp4).
 *   - Whisper SDK accept đa dạng codec qua ffmpeg backend.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileText, Loader2, Mic, MicOff, Sparkles, Square } from 'lucide-react';
import { toast } from 'sonner';

import { apiUpload } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

type Hit = {
  chunkId: string;
  docId: string;
  docTitle: string;
  pageNum: number;
  content: string;
};

type SearchResponse = {
  transcript: string;
  language: string;
  hits: Hit[];
  quota?: { used: number; limit: number };
  searchError?: string;
};

/** B3.17: câu hỏi mẫu giúp user lần đầu biết cần nói gì. */
const SAMPLE_QUESTIONS = [
  'Đạo hàm hàm hợp là gì?',
  'Định lý Vi-et áp dụng thế nào?',
  'Phản ứng oxi hoá khử',
  'IELTS speaking part 2',
];

export function VoiceSearchClient() {
  const t = useT();
  const [recording, setRecording] = React.useState(false);
  const [processing, setProcessing] = React.useState(false);
  const [permissionDenied, setPermissionDenied] = React.useState(false);
  const [result, setResult] = React.useState<SearchResponse | null>(null);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = async () => {
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        stopStream();
        void upload(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setPermissionDenied(true);
      toast.error(t('library.voice.mic_error') + ' ' + (err as Error).message);
    }
  };

  const stop = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
  };

  const upload = async (blob: Blob) => {
    setProcessing(true);
    try {
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const form = new FormData();
      form.append('audio', new File([blob], `voice.${ext}`, { type: blob.type }));
      form.append('language', 'vi');
      const data = await apiUpload<SearchResponse>(
        '/api/library/voice-search',
        form,
      );
      setResult(data);
      if (data.hits.length === 0) {
        toast.info(t('library.voice.no_match'));
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  React.useEffect(() => () => stopStream(), []);

  return (
    <div className="space-y-4">
      {/* Mic button */}
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-divider bg-card p-8">
        {permissionDenied ? (
          <div className="text-center text-[12px] text-rose-700 dark:text-rose-300">
            <MicOff className="mx-auto mb-2 h-8 w-8" />
            {t('library.voice.permission_denied')}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={recording ? stop : start}
              disabled={processing}
              className={cn(
                'group/m relative flex h-24 w-24 items-center justify-center rounded-full shadow-lg transition-all',
                recording
                  ? 'bg-rose-500 text-white animate-pulse'
                  : 'bg-gradient-to-br from-discovery-600 to-fuchsia-600 text-white hover:scale-105',
                processing && 'opacity-60',
              )}
              aria-label={recording ? t('library.voice.aria_stop') : t('library.voice.aria_start')}
            >
              {processing ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : recording ? (
                <Square className="h-8 w-8 fill-white" />
              ) : (
                <Mic className="h-10 w-10" />
              )}
            </button>
            <p className="text-[12px] text-muted-foreground">
              {processing
                ? t('library.voice.processing')
                : recording
                  ? t('library.voice.recording')
                  : t('library.voice.idle')}
            </p>
          </>
        )}

        {/* B3.17: sample questions chip — onboarding hint cho user lần đầu.
            Hiển thị khi chưa có kết quả + không đang recording/processing. */}
        {!recording && !processing && !result && !permissionDenied && (
          <div className="w-full border-t border-divider pt-4">
            <p className="mb-2 text-center text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('library.voice.try_sample')}
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SAMPLE_QUESTIONS.map((q) => (
                <span
                  key={q}
                  className="rounded-full border border-divider bg-muted/30 px-2.5 py-1 text-[11px] italic text-muted-foreground"
                >
                  &ldquo;{q}&rdquo;
                </span>
              ))}
            </div>
            <p className="mt-2 text-center text-[10px] text-muted-foreground/70">
              {t('library.voice.sample_hint')}
            </p>
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-3">
          <div className="rounded-xl border border-discovery-500/30 bg-discovery-500/5 p-4">
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-discovery-700 dark:text-discovery-300">
              {t('library.voice.you_said')} ({result.language})
            </p>
            <p className="text-[13px] italic text-foreground/90">
              &ldquo;{result.transcript}&rdquo;
            </p>
            {result.quota && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                {t('library.voice.quota')
                  .replace('{used}', String(result.quota.used))
                  .replace('{limit}', String(result.quota.limit))}
              </p>
            )}
          </div>

          {result.hits.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                {t('library.voice.top_match_prefix')} {result.hits.length} {t('library.voice.top_match_suffix')}
              </p>
              <div className="space-y-2">
                {result.hits.map((h) => (
                  <Link
                    key={h.chunkId}
                    href={`/library/${h.docId}`}
                    className="block rounded-lg border border-divider bg-card p-3 transition-colors hover:border-discovery-500/40 hover:bg-muted/30"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-discovery-600" />
                      <p className="text-[12.5px] font-semibold">{h.docTitle}</p>
                      <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                        {t('library.voice.page')} {h.pageNum}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-[11.5px] text-muted-foreground">
                      {h.content}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {result.searchError && (
            <p className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-700 dark:text-rose-300">
              {t('library.voice.search_error')} {result.searchError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
