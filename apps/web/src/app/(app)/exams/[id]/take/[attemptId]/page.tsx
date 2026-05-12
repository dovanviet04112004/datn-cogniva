/**
 * /exams/[id]/take/[attemptId] — taking interface.
 *
 * Layout: 1 câu/màn (focus mode) + sidebar nhỏ điều hướng câu + countdown
 * (TIMED mode) + progress bar.
 *
 * Flow:
 *   1. Load attempt + questions từ /api/attempts/[attemptId]
 *   2. Render câu hiện tại theo `currentIdx`
 *   3. User trả lời → POST /api/attempts/[attemptId]/responses (auto-save)
 *   4. Practice mode: query ?grade=1 để grade ngay → show feedback
 *   5. Hết câu hoặc user bấm "Nộp bài" → POST /submit → redirect results
 *   6. TIMED: countdown từ (startedAt + duration) - now. Hết giờ auto submit.
 */
'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Clock, Send, CheckCircle, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface ExamData {
  id: string;
  title: string;
  mode: string;
  durationSeconds: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  allowReview: boolean;
  maxScore: number;
}

interface QuestionData {
  id: string;
  type: string;
  prompt: string;
  options: string[] | null;
  points: number;
  timeLimitSeconds: number | null;
  orderIndex: number;
}

interface AttemptData {
  id: string;
  status: string;
  startedAt: string;
  examId: string;
}

interface ResponseData {
  questionId: string;
  answer: unknown;
  isCorrect: boolean | null;
  pointsEarned: number;
}

/**
 * Deterministic shuffle dùng attemptId làm seed → mỗi user thấy thứ tự khác
 * nhau nhưng consistent qua reload. Cùng attemptId → cùng order.
 */
function shuffle<T>(arr: T[], seed: string): T[] {
  // Simple LCG seeded by hash của seed string
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) | 0;
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export default function TakeExamPage() {
  const router = useRouter();
  const { id: examId, attemptId } = useParams<{ id: string; attemptId: string }>();

  const [exam, setExam] = React.useState<ExamData | null>(null);
  const [attempt, setAttempt] = React.useState<AttemptData | null>(null);
  const [questions, setQuestions] = React.useState<QuestionData[]>([]);
  const [responses, setResponses] = React.useState<Map<string, ResponseData>>(new Map());
  const [currentIdx, setCurrentIdx] = React.useState(0);
  const [draftAnswer, setDraftAnswer] = React.useState<unknown>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [remainingSec, setRemainingSec] = React.useState<number | null>(null);
  const [feedback, setFeedback] = React.useState<{ isCorrect: boolean; points: number } | null>(null);
  // Ref giữ timeout id để continueAfterFeedback có thể cancel khi user
  // click "Câu sau →" sớm trước khi auto-advance fire
  const advanceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load initial data
  React.useEffect(() => {
    fetch(`/api/attempts/${attemptId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { exam: ExamData; attempt: AttemptData; questions: QuestionData[]; responses: ResponseData[] }) => {
        setExam(d.exam);
        setAttempt(d.attempt);
        const shuffled = d.exam.shuffleQuestions
          ? shuffle(d.questions, d.attempt.id)
          : d.questions;
        setQuestions(shuffled);
        const respMap = new Map(d.responses.map((r) => [r.questionId, r]));
        setResponses(respMap);

        // Nếu attempt đã SUBMITTED → redirect result
        if (d.attempt.status !== 'IN_PROGRESS') {
          router.replace(`/exams/${d.exam.id}/results/${d.attempt.id}`);
          return;
        }
      })
      .catch((err) => toast.error('Load fail: ' + err.message))
      .finally(() => setLoading(false));
  }, [attemptId, router]);

  // Countdown timer cho TIMED mode
  React.useEffect(() => {
    if (!exam || !attempt || exam.mode !== 'TIMED' || !exam.durationSeconds) return;
    const startMs = new Date(attempt.startedAt).getTime();
    const endMs = startMs + exam.durationSeconds * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
      setRemainingSec(remaining);
      if (remaining === 0) {
        // Hết giờ — auto submit
        void submitAttempt();
      }
    };
    tick();
    const intv = setInterval(tick, 1000);
    return () => clearInterval(intv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam, attempt]);

  // Khi đổi câu → load draft từ responses (nếu đã trả lời rồi)
  React.useEffect(() => {
    const q = questions[currentIdx];
    if (!q) return;
    const existing = responses.get(q.id);
    setDraftAnswer(existing?.answer ?? defaultAnswer(q.type));
    setFeedback(null);
  }, [currentIdx, questions, responses]);

  // Auto-advance giờ làm INLINE trong onNext (setTimeout sau setFeedback) —
  // tránh useEffect closure issue + simpler timing control

  const saveAnswer = async (questionId: string, answer: unknown, grade = false): Promise<{ isCorrect: boolean | null; pointsEarned: number } | null> => {
    try {
      const url = `/api/attempts/${attemptId}/responses${grade ? '?grade=1' : ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId, answer }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { graded: boolean; isCorrect: boolean | null; pointsEarned: number };
      // Update local responses map
      setResponses((map) => {
        const next = new Map(map);
        next.set(questionId, {
          questionId,
          answer,
          isCorrect: data.isCorrect,
          pointsEarned: data.pointsEarned,
        });
        return next;
      });
      return data;
    } catch (err) {
      toast.error('Lưu fail: ' + (err as Error).message);
      return null;
    }
  };

  const submitAttempt = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Save câu hiện tại trước khi submit (nếu chưa save)
      const q = questions[currentIdx];
      if (q && draftAnswer !== null) {
        await saveAnswer(q.id, draftAnswer);
      }
      const res = await fetch(`/api/attempts/${attemptId}/submit`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Đã nộp bài');
      router.push(`/exams/${examId}/results/${attemptId}`);
    } catch (err) {
      toast.error('Nộp fail: ' + (err as Error).message);
      setSubmitting(false);
    }
  };

  const onNext = async () => {
    if (busy) return; // chống double-click race
    const q = questions[currentIdx];
    if (!q) return;
    setBusy(true);
    const isPractice = exam?.mode === 'PRACTICE';
    try {
      if (draftAnswer !== null && draftAnswer !== '' && draftAnswer !== undefined) {
        const result = await saveAnswer(q.id, draftAnswer, isPractice);
        if (isPractice && result) {
          // Practice: hiện feedback + auto-advance sau 2.5s (cancel-able)
          setFeedback({ isCorrect: result.isCorrect ?? false, points: result.pointsEarned });
          if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
          advanceTimerRef.current = setTimeout(() => {
            advanceTimerRef.current = null;
            setFeedback(null);
            setCurrentIdx((i) => Math.min(i + 1, questions.length - 1));
            setBusy(false);
          }, 2500);
          return;
        }
      }
      // Timed mode hoặc no answer: advance ngay
      if (currentIdx < questions.length - 1) {
        setCurrentIdx((i) => i + 1);
      }
    } catch (err) {
      toast.error('Có lỗi: ' + (err as Error).message);
    } finally {
      // Chỉ unset busy nếu không trong Practice timer (setTimeout đã handle)
      if (!isPractice) setBusy(false);
    }
  };

  const continueAfterFeedback = () => {
    // Cancel auto-advance timer + clear busy + advance ngay
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setFeedback(null);
    setBusy(false);
    if (currentIdx < questions.length - 1) {
      setCurrentIdx((i) => i + 1);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Đang tải...</div>;
  }
  if (!exam || !attempt || questions.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Không tìm thấy exam.</div>;
  }

  const q = questions[currentIdx]!;
  const isLast = currentIdx === questions.length - 1;
  const answered = responses.size;
  const progress = (answered / questions.length) * 100;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      {/* Top bar: title + countdown */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{exam.title}</h1>
          <p className="text-xs text-muted-foreground">
            Câu {currentIdx + 1}/{questions.length} · Đã trả lời: {answered}
          </p>
        </div>
        {remainingSec !== null && (
          <div
            className={`flex items-center gap-1 rounded px-3 py-1 text-sm font-semibold ${
              remainingSec < 60 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
            }`}
          >
            <Clock className="h-4 w-4" />
            {formatTime(remainingSec)}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full overflow-hidden rounded bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Question card */}
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-primary/10 px-2 py-0.5 font-semibold text-primary">
            Câu {currentIdx + 1}
          </span>
          <span>{q.points} điểm</span>
        </div>
        <p className="whitespace-pre-wrap text-base">{q.prompt}</p>

        <div>
          {q.type === 'MCQ_SINGLE' && q.options && (
            <McqSingle
              options={q.options}
              value={typeof draftAnswer === 'number' ? draftAnswer : null}
              onChange={setDraftAnswer}
              shuffleSeed={exam.shuffleOptions ? `${attemptId}-${q.id}` : null}
              disabled={!!feedback}
            />
          )}
          {q.type === 'MCQ_MULTI' && q.options && (
            <McqMulti
              options={q.options}
              value={Array.isArray(draftAnswer) ? (draftAnswer as number[]) : []}
              onChange={setDraftAnswer}
              disabled={!!feedback}
            />
          )}
          {q.type === 'TRUE_FALSE' && (
            <TrueFalse
              value={typeof draftAnswer === 'boolean' ? draftAnswer : null}
              onChange={setDraftAnswer}
              disabled={!!feedback}
            />
          )}
          {(q.type === 'SHORT' || q.type === 'FILL_BLANK') && (
            <Input
              value={typeof draftAnswer === 'string' ? draftAnswer : ''}
              onChange={(e) => setDraftAnswer(e.target.value)}
              placeholder="Nhập câu trả lời..."
              disabled={!!feedback}
            />
          )}
          {q.type === 'ESSAY' && (
            <textarea
              value={typeof draftAnswer === 'string' ? draftAnswer : ''}
              onChange={(e) => setDraftAnswer(e.target.value)}
              rows={8}
              placeholder="Viết câu trả lời tự luận..."
              disabled={!!feedback}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          )}
        </div>

        {/* Practice mode feedback — auto-advance sau 2.5s */}
        {feedback && (
          <div
            className={`flex items-center gap-3 rounded-md border-2 p-4 text-base ${
              feedback.isCorrect
                ? 'border-green-300 bg-green-50 text-green-900'
                : 'border-red-300 bg-red-50 text-red-900'
            }`}
          >
            {feedback.isCorrect ? (
              <CheckCircle className="h-6 w-6 shrink-0" />
            ) : (
              <XCircle className="h-6 w-6 shrink-0" />
            )}
            <span className="font-semibold">
              {feedback.isCorrect ? 'Đúng!' : 'Sai'} ·{' '}
              {feedback.points}/{q.points} điểm
            </span>
            <Button
              size="default"
              variant={feedback.isCorrect ? 'default' : 'outline'}
              className="ml-auto"
              onClick={continueAfterFeedback}
            >
              Câu sau <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        )}
      </Card>

      {/* Nav */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          disabled={currentIdx === 0 || !!feedback}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Câu trước
        </Button>
        <div className="text-xs text-muted-foreground">
          {currentIdx + 1}/{questions.length}
        </div>
        {!isLast ? (
          <Button onClick={onNext} disabled={busy || !!feedback}>
            {busy && !feedback ? 'Đang lưu...' : 'Câu sau'}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submitAttempt} disabled={submitting || busy || !!feedback}>
            <Send className="mr-1 h-4 w-4" />
            {submitting ? 'Đang nộp...' : 'Nộp bài'}
          </Button>
        )}
      </div>
    </div>
  );
}

function defaultAnswer(type: string): unknown {
  switch (type) {
    case 'MCQ_SINGLE':
      return null;
    case 'MCQ_MULTI':
      return [];
    case 'TRUE_FALSE':
      return null;
    case 'SHORT':
    case 'FILL_BLANK':
    case 'ESSAY':
      return '';
    default:
      return null;
  }
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

// ─── Sub-components ────────────────────────────────────────

function McqSingle({
  options,
  value,
  onChange,
  shuffleSeed,
  disabled,
}: {
  options: string[];
  value: number | null;
  onChange: (v: number) => void;
  shuffleSeed: string | null;
  disabled: boolean;
}) {
  // Hiển thị thứ tự shuffle nhưng map index về original cho onChange
  const indices = React.useMemo(() => {
    const base = options.map((_, i) => i);
    return shuffleSeed ? shuffle(base, shuffleSeed) : base;
  }, [options, shuffleSeed]);

  return (
    <div className="space-y-2">
      {indices.map((origIdx, i) => (
        <label
          key={i}
          className={`flex cursor-pointer items-center gap-3 rounded border p-3 ${
            value === origIdx ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent'
          } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <input
            type="radio"
            checked={value === origIdx}
            onChange={() => onChange(origIdx)}
            disabled={disabled}
          />
          <span className="font-mono text-xs text-muted-foreground">
            {String.fromCharCode(65 + i)}.
          </span>
          <span className="text-sm">{options[origIdx]}</span>
        </label>
      ))}
    </div>
  );
}

function McqMulti({
  options,
  value,
  onChange,
  disabled,
}: {
  options: string[];
  value: number[];
  onChange: (v: number[]) => void;
  disabled: boolean;
}) {
  const toggle = (i: number) => {
    if (value.includes(i)) onChange(value.filter((x) => x !== i));
    else onChange([...value, i].sort((a, b) => a - b));
  };
  return (
    <div className="space-y-2">
      {options.map((opt, i) => (
        <label
          key={i}
          className={`flex cursor-pointer items-center gap-3 rounded border p-3 ${
            value.includes(i) ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent'
          } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <input
            type="checkbox"
            checked={value.includes(i)}
            onChange={() => toggle(i)}
            disabled={disabled}
          />
          <span className="font-mono text-xs text-muted-foreground">
            {String.fromCharCode(65 + i)}.
          </span>
          <span className="text-sm">{opt}</span>
        </label>
      ))}
    </div>
  );
}

function TrueFalse({
  value,
  onChange,
  disabled,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange(true)}
        disabled={disabled}
        className={`flex-1 rounded border p-3 ${
          value === true ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        Đúng
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        disabled={disabled}
        className={`flex-1 rounded border p-3 ${
          value === false ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        Sai
      </button>
    </div>
  );
}
