/**
 * TtsButton — đọc to nội dung assistant message bằng SpeechSynthesis API.
 *
 * Free + native, hỗ trợ tiếng Việt nếu OS có voice vi-VN (Win/macOS có
 * sẵn). Trade-off: giọng máy hơn ElevenLabs.
 *
 * UX:
 *   - Idle: speaker icon outline
 *   - Speaking: speaker icon filled, click lại để stop
 *   - Auto-stop khi component unmount
 */
'use client';

import * as React from 'react';
import { Volume2, VolumeX } from 'lucide-react';

type Props = {
  text: string;
  /** Ngôn ngữ ưu tiên — mặc định auto detect; có thể force vi-VN. */
  lang?: string;
};

export function TtsButton({ text, lang = 'vi-VN' }: Props) {
  const [speaking, setSpeaking] = React.useState(false);
  // `supported` evaluate `typeof window` → server = false, client = true →
  // hydration mismatch. Defer detection sang useEffect để first paint match SSR.
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);

  const speak = () => {
    if (!supported || !text.trim()) return;
    // Stop nếu đang nói cái khác
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = 1.05;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
    setSpeaking(true);
  };

  const stop = () => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  // Cleanup khi unmount
  React.useEffect(() => {
    return () => {
      if (speaking) window.speechSynthesis.cancel();
    };
  }, [speaking]);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={speaking ? stop : speak}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
      aria-label={speaking ? 'Dừng đọc' : 'Đọc to'}
      title={speaking ? 'Dừng' : 'Đọc to'}
    >
      {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
    </button>
  );
}
