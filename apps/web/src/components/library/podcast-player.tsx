'use client';

import * as React from 'react';
import {
  Headphones,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { toast } from 'sonner';

import { apiSend } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { ComboSelect } from '@/components/ui/combo-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

type Turn = { speaker: 'A' | 'B'; text: string };

type PodcastData = {
  title: string;
  turns: Turn[];
  estimatedDurationSec: number;
};

const SPEAKER_META = {
  A: {
    name: 'Linh',
    emoji: '👩',
    gender: 'female' as const,
    color: 'text-discovery-700 dark:text-discovery-300',
  },
  B: {
    name: 'Minh',
    emoji: '👨',
    gender: 'male' as const,
    color: 'text-sky-700 dark:text-sky-300',
  },
};

export function PodcastPlayer({ docId }: { docId: string }) {
  const t = useT();
  const [data, setData] = React.useState<PodcastData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  const [playing, setPlaying] = React.useState(false);
  const [currentTurn, setCurrentTurn] = React.useState(0);
  const [rate, setRate] = React.useState(1);
  const [voiceA, setVoiceA] = React.useState<SpeechSynthesisVoice | null>(null);
  const [voiceB, setVoiceB] = React.useState<SpeechSynthesisVoice | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const pickVoices = () => {
      const all = window.speechSynthesis.getVoices();
      const vi = all.filter((v) => v.lang.startsWith('vi'));
      const en = all.filter((v) => v.lang.startsWith('en'));
      const candidates = vi.length > 0 ? vi : en;
      const female =
        candidates.find((v) => /female|linh|mai|huy|nữ/i.test(v.name)) || candidates[0];
      const male =
        candidates.find((v) => /male|minh|nam|tuấn|nam|david/i.test(v.name) && v !== female) ||
        candidates.find((v) => v !== female) ||
        candidates[0];
      setVoiceA(female ?? null);
      setVoiceB(male ?? null);
    };
    pickVoices();
    window.speechSynthesis.onvoiceschanged = pickVoices;
  }, []);

  React.useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const fetchScript = async () => {
    setLoading(true);
    setOpen(true);
    try {
      const d = await apiSend<PodcastData>(`/api/library/docs/${docId}/podcast`, 'POST');
      setData(d);
      setCurrentTurn(0);
    } catch (err) {
      toast.error((err as Error).message);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const playTurn = React.useCallback(
    (idx: number) => {
      if (!data) return;
      if (idx >= data.turns.length) {
        setPlaying(false);
        setCurrentTurn(0);
        toast.success(t('library.podcast.ended'));
        return;
      }
      const turn = data.turns[idx]!;
      const utter = new SpeechSynthesisUtterance(turn.text);
      const voice = turn.speaker === 'A' ? voiceA : voiceB;
      if (voice) utter.voice = voice;
      utter.rate = rate;
      utter.pitch = turn.speaker === 'A' ? 1.1 : 0.95;
      utter.lang = voice?.lang ?? 'vi-VN';
      utter.onend = () => {
        setCurrentTurn(idx + 1);
        playTurn(idx + 1);
      };
      utter.onerror = () => {
        toast.error(t('library.podcast.tts_error'));
        setPlaying(false);
      };
      window.speechSynthesis.speak(utter);
    },
    [data, voiceA, voiceB, rate, t],
  );

  const togglePlay = () => {
    if (!('speechSynthesis' in window)) {
      toast.error(t('library.podcast.no_speech_api'));
      return;
    }
    if (playing) {
      window.speechSynthesis.pause();
      setPlaying(false);
    } else {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      } else {
        window.speechSynthesis.cancel();
        playTurn(currentTurn);
      }
      setPlaying(true);
    }
  };

  const reset = () => {
    window.speechSynthesis.cancel();
    setPlaying(false);
    setCurrentTurn(0);
  };

  const skip = (delta: number) => {
    window.speechSynthesis.cancel();
    const next = Math.max(0, Math.min((data?.turns.length ?? 1) - 1, currentTurn + delta));
    setCurrentTurn(next);
    if (playing) playTurn(next);
  };

  return (
    <>
      <button
        type="button"
        onClick={fetchScript}
        className="border-divider bg-card hover:bg-muted inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
      >
        <Headphones className="h-3.5 w-3.5" />
        {t('library.podcast.listen')}
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            reset();
            setOpen(false);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-1.5 text-base">
              <Headphones className="text-discovery-600 h-4 w-4" />
              {t('library.podcast.title')}
              {data &&
                ` · ~${Math.ceil(data.estimatedDurationSec / 60)} ${t('library.podcast.minutes')}`}
            </DialogTitle>
          </DialogHeader>

          {loading || !data ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-[12px]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('library.podcast.writing')}
            </div>
          ) : (
            <>
              <div className="border-divider bg-background mb-3 flex items-center gap-1.5 rounded-lg border p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => skip(-1)}
                  disabled={currentTurn === 0}
                  className="h-7 px-1.5"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                </Button>
                <Button variant="default" size="sm" onClick={togglePlay} className="h-7 px-2">
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => skip(1)}
                  disabled={currentTurn >= data.turns.length - 1}
                  className="h-7 px-1.5"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={reset} className="h-7 px-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <div className="ml-auto flex items-center gap-1">
                  <Settings2 className="text-muted-foreground h-3 w-3" />
                  <ComboSelect
                    value={String(rate)}
                    onChange={(v) => setRate(Number(v))}
                    options={[
                      { value: '0.75', label: '0.75×' },
                      { value: '1', label: '1×' },
                      { value: '1.25', label: '1.25×' },
                      { value: '1.5', label: '1.5×' },
                      { value: '2', label: '2×' },
                    ]}
                    className="text-[10px]"
                  />
                </div>
              </div>

              <div className="bg-muted mb-2 h-1 overflow-hidden rounded-full">
                <div
                  className="bg-discovery-500 h-full transition-all"
                  style={{
                    width: `${((currentTurn + (playing ? 0.5 : 0)) / data.turns.length) * 100}%`,
                  }}
                />
              </div>
              <p className="text-muted-foreground mb-2 text-center text-[10px]">
                {t('library.podcast.turn')
                  .replace('{current}', String(currentTurn + 1))
                  .replace('{total}', String(data.turns.length))}
              </p>

              <ul className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
                {data.turns.map((turn, idx) => {
                  const meta = SPEAKER_META[turn.speaker];
                  const isActive = idx === currentTurn;
                  return (
                    <li
                      key={idx}
                      onClick={() => {
                        window.speechSynthesis.cancel();
                        setCurrentTurn(idx);
                        if (playing) playTurn(idx);
                      }}
                      className={cn(
                        'cursor-pointer rounded-md border p-2 transition-all',
                        isActive
                          ? 'border-discovery-500 bg-discovery-500/10 shadow-sm'
                          : 'border-divider/60 bg-background hover:bg-muted/50',
                      )}
                    >
                      <p className={cn('mb-0.5 text-[10.5px] font-semibold', meta.color)}>
                        {meta.emoji} {meta.name}
                      </p>
                      <p className="text-[11.5px] leading-relaxed">{turn.text}</p>
                    </li>
                  );
                })}
              </ul>

              {(!voiceA || !voiceB) && (
                <p className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300">
                  {t('library.podcast.no_voice')}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
