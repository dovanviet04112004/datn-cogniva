/**
 * VoiceInputButton — mic toggle dùng Web Speech API (browser native).
 *
 * Hỗ trợ:
 *   - Chrome / Edge / Safari (webkitSpeechRecognition)
 *   - Firefox HIỆN tại không hỗ trợ → button render disabled với tooltip
 *
 * UX:
 *   - Click mic → bắt đầu listen, button đỏ pulsing
 *   - Mỗi câu nói recognized → append vào composer (qua callback)
 *   - Click lại → stop. Auto-stop sau 30s im lặng.
 *
 * Free + zero latency vì chạy local, trade-off chất lượng kém Whisper.
 * Phase 9+ có thể swap sang Whisper API.
 */
'use client';

import * as React from 'react';
import { Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

// Web Speech API types không có sẵn trong @types — declare minimal
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: { transcript: string };
    };
  };
};

type SpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognition;

type Props = {
  onTranscript: (text: string) => void;
  disabled?: boolean;
};

export function VoiceInputButton({ onTranscript, disabled }: Props) {
  const [listening, setListening] = React.useState(false);
  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const supported = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    return (
      typeof (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition !==
        'undefined' ||
      typeof (window as unknown as { webkitSpeechRecognition?: unknown })
        .webkitSpeechRecognition !== 'undefined'
    );
  }, []);

  const start = () => {
    if (!supported) {
      toast.error('Trình duyệt không hỗ trợ nhận dạng giọng nói (cần Chrome/Edge/Safari)');
      return;
    }
    const Ctor =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
        .webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = 'vi-VN'; // ưu tiên tiếng Việt, vẫn nhận tiếng Anh tốt
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const firstAlt = result[0];
        if (result.isFinal && firstAlt) {
          finalText += firstAlt.transcript;
        }
      }
      if (finalText) onTranscript(finalText.trim());
    };
    recognition.onerror = (e) => {
      // 'no-speech' / 'aborted' → bỏ qua, im lặng
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast.error('Cần cấp quyền microphone trong browser');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        toast.error('Voice error: ' + e.error);
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  };

  const stop = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  React.useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  return (
    <Button
      type="button"
      variant={listening ? 'destructive' : 'outline'}
      size="icon"
      onClick={listening ? stop : start}
      disabled={disabled || !supported}
      aria-label={listening ? 'Dừng nghe' : 'Bắt đầu nói'}
      title={supported ? (listening ? 'Click để dừng' : 'Click để nói') : 'Trình duyệt không hỗ trợ'}
    >
      {listening ? (
        <MicOff className="h-4 w-4 animate-pulse" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
