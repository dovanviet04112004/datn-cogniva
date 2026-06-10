/**
 * AtomDetailClient — render full info 1 atom + load items async.
 *
 * Phase C (atom-centric). Spec: docs/plans/atom-centric.md §5.1.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │ Header: name + domain + mastery chip + actions       │
 *   ├──────────────────────────────────────────────────────┤
 *   │ Definition + examples + preview Q/A                  │
 *   ├──────────────────────────────────────────────────────┤
 *   │ Mastery card                                          │
 *   ├──────────────────────────────────────────────────────┤
 *   │ Flashcards section (load async)                      │
 *   │ Quiz questions section                               │
 *   │ Exam questions section                               │
 *   └──────────────────────────────────────────────────────┘
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  BrainCircuit,
  ClipboardList,
  Clock,
  GraduationCap,
  ListChecks,
  Loader2,
  Play,
  Sparkles,
  Target,
} from 'lucide-react';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Mastery = {
  score: number;
  attempts: number;
  correct: number;
  lastSeenAt: string | null;
  lastQuizAt: string | null;
  lastFlashcardAt: string | null;
  lastExamAt: string | null;
};

type Atom = {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  examples: string[];
  difficulty: number | null;
  previewQuestion: string | null;
  previewAnswer: string | null;
  mastery: Mastery | null;
  counts: {
    flashcards: number;
    quizQuestions: number;
    examQuestions: number;
  };
};

type FlashcardItem = {
  id: string;
  front: string;
  back: string;
  cardType: string;
  state: string;
  due: string;
  lastReview: string | null;
};

type QuizQuestionItem = {
  id: string;
  prompt: string;
  type: string;
  quizId: string;
  quizTitle: string;
  quizCreatedAt: string;
};

type ExamQuestionItem = {
  id: string;
  prompt: string;
  type: string;
  examId: string;
  examTitle: string;
};

type Items = {
  flashcards: FlashcardItem[];
  quizQuestions: QuizQuestionItem[];
  examQuestions: ExamQuestionItem[];
};

type Props = {
  workspaceId: string;
  atom: Atom;
};

// Icons không nên pass từ Server Component (LucideIcon là React component
// object có method `render`, KHÔNG serializable qua RSC boundary). Import
// trực tiếp trong client component.
const ICONS: {
  flashcards: LucideIcon;
  quizzes: LucideIcon;
  exams: LucideIcon;
  atom: LucideIcon;
} = {
  flashcards: BrainCircuit,
  quizzes: ListChecks,
  exams: ClipboardList,
  atom: GraduationCap,
};

export function AtomDetailClient({ workspaceId, atom }: Props) {
  // V6: bỏ AI Tutor drawer global. User muốn hỏi AI về atom → bấm
  // "Mở trong workspace" → chat ở center, atom có thể pin qua Sources checkbox.
  // React Query: cache theo (atom, workspace); lỗi → coi như rỗng (giữ UX cũ).
  const { data: items, isLoading: loading } = useQuery({
    queryKey: qk.atomItems(atom.id, workspaceId),
    queryFn: () =>
      apiGet<Items>(`/api/atoms/${atom.id}/items?workspaceId=${workspaceId}`).catch(
        () => ({ flashcards: [], quizQuestions: [], examQuestions: [] }) as Items,
      ),
  });

  const mastery = atom.mastery;
  const masteryStyle = getMasteryStyle(mastery?.score ?? null);
  const AtomIcon = ICONS.atom;
  const FCIcon = ICONS.flashcards;
  const QuizIcon = ICONS.quizzes;
  const ExamIcon = ICONS.exams;

  return (
    <div className="space-y-6">
      {/* ── Header card ───────────────────────────────────── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <AtomIcon className="h-4 w-4 text-primary" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                Atom · {atom.domain}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{atom.name}</h1>
            {atom.description && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {atom.description}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {/* V6: "Mở trong workspace" là entry point chính để chat / học —
                AI Tutor drawer riêng đã bỏ. */}
            <Link
              href={`/workspaces/${workspaceId}?view=chat`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              title="Quay về workspace notebook (Sources · Chat · Studio)"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Mở trong workspace
            </Link>
            <div
              className={cn(
                'rounded-lg border px-3 py-2 text-center text-xs font-semibold',
                masteryStyle.bg,
                masteryStyle.color,
              )}
            >
              <div className="uppercase tracking-wider">{masteryStyle.label}</div>
              {mastery?.score != null && (
                <div className="mt-0.5 font-mono text-base">
                  {(mastery.score * 100).toFixed(0)}%
                </div>
              )}
            </div>
            {atom.difficulty !== null && (
              <div className="rounded-lg border border-divider bg-card px-3 py-2 text-center text-[10.5px] text-muted-foreground">
                <div className="uppercase tracking-wider">Khó</div>
                <div className="mt-0.5 font-mono text-base text-foreground">
                  {(atom.difficulty * 100).toFixed(0)}%
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Examples */}
        {atom.examples.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
              Ví dụ
            </h3>
            <ul className="space-y-1 text-sm">
              {atom.examples.map((ex, i) => (
                <li key={i} className="flex gap-2 text-muted-foreground">
                  <span className="text-primary">·</span>
                  <span>{ex}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Preview Q/A */}
        {atom.previewQuestion && (
          <div className="mt-4 border-t pt-4">
            <h3 className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
              <Sparkles className="h-3 w-3 text-primary" />
              Tự hỏi
            </h3>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-medium">{atom.previewQuestion}</p>
              {atom.previewAnswer && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  → {atom.previewAnswer}
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── Mastery card (chỉ show nếu đã có mastery) ───── */}
      {mastery && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Target className="h-3.5 w-3.5 text-primary" />
              Tiến độ học atom
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {mastery.attempts} lần ·{' '}
              {mastery.attempts > 0
                ? Math.round((mastery.correct / mastery.attempts) * 100)
                : 0}
              % chính xác
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MasteryTimestamp
              label="Flashcard"
              ts={mastery.lastFlashcardAt}
              icon={<FCIcon className="h-3 w-3" />}
            />
            <MasteryTimestamp
              label="Quiz"
              ts={mastery.lastQuizAt}
              icon={<QuizIcon className="h-3 w-3" />}
            />
            <MasteryTimestamp
              label="Exam"
              ts={mastery.lastExamAt}
              icon={<ExamIcon className="h-3 w-3" />}
            />
          </div>
        </Card>
      )}

      {/* ── Items: flashcards + quiz + exam ───────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items ? (
        <>
          <SectionFlashcards items={items.flashcards} icon={FCIcon} />
          <SectionQuizQuestions items={items.quizQuestions} icon={QuizIcon} />
          <SectionExamQuestions items={items.examQuestions} icon={ExamIcon} />
        </>
      ) : null}
    </div>
  );
}

function getMasteryStyle(score: number | null) {
  if (score === null) {
    return {
      label: 'Chưa biết',
      color: 'text-slate-500',
      bg: 'bg-slate-500/10 border-slate-500/20',
    };
  }
  if (score >= 0.85) {
    return {
      label: 'Master',
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/20',
    };
  }
  if (score >= 0.3) {
    return {
      label: 'Đang học',
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10 border-amber-500/20',
    };
  }
  return {
    label: 'Yếu',
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
  };
}

function MasteryTimestamp({
  label,
  ts,
  icon,
}: {
  label: string;
  ts: string | null;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-divider bg-card p-3">
      <div className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xs">
        {ts ? (
          <span className="inline-flex items-center gap-1 text-foreground">
            <Clock className="h-3 w-3 opacity-60" />
            {formatRelative(ts)}
          </span>
        ) : (
          <span className="text-muted-foreground">Chưa có</span>
        )}
      </div>
    </div>
  );
}

function formatRelative(ts: string): string {
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return d.toLocaleDateString('vi-VN');
}

function SectionFlashcards({
  items,
  icon: Icon,
}: {
  items: FlashcardItem[];
  icon: LucideIcon;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHeading label="Flashcards" count={items.length} icon={<Icon className="h-3.5 w-3.5" />}>
        <Link
          href="/flashcards/review"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 text-[11px] font-medium text-primary hover:bg-primary/10"
        >
          <Play className="h-3 w-3" />
          Ôn ngay
        </Link>
      </SectionHeading>
      <ul className="space-y-1.5">
        {items.map((c) => (
          <li
            key={c.id}
            className="flex items-start gap-3 rounded-lg border border-divider bg-card p-3 text-sm"
          >
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {c.cardType}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.front}</p>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {c.back || '(cloze auto)'}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {c.state}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionQuizQuestions({
  items,
  icon: Icon,
}: {
  items: QuizQuestionItem[];
  icon: LucideIcon;
}) {
  if (items.length === 0) return null;
  // Group by quiz
  const byQuiz = new Map<
    string,
    { title: string; createdAt: string; questions: QuizQuestionItem[] }
  >();
  for (const q of items) {
    const existing = byQuiz.get(q.quizId);
    if (existing) {
      existing.questions.push(q);
    } else {
      byQuiz.set(q.quizId, {
        title: q.quizTitle,
        createdAt: q.quizCreatedAt,
        questions: [q],
      });
    }
  }

  return (
    <section>
      <SectionHeading
        label="Quiz có atom này"
        count={items.length}
        icon={<Icon className="h-3.5 w-3.5" />}
      />
      <ul className="space-y-1.5">
        {Array.from(byQuiz.entries()).map(([quizId, info]) => (
          <li
            key={quizId}
            className="flex items-center gap-3 rounded-lg border border-divider bg-card p-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{info.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {info.questions.length} câu · {new Date(info.createdAt).toLocaleDateString('vi-VN')}
              </p>
            </div>
            <Link
              href={`/quiz/${quizId}/attempt`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 text-[11px] font-medium text-primary hover:bg-primary/10"
            >
              <Play className="h-3 w-3" />
              Làm
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionExamQuestions({
  items,
  icon: Icon,
}: {
  items: ExamQuestionItem[];
  icon: LucideIcon;
}) {
  if (items.length === 0) return null;
  const byExam = new Map<
    string,
    { title: string; questions: ExamQuestionItem[] }
  >();
  for (const q of items) {
    const existing = byExam.get(q.examId);
    if (existing) existing.questions.push(q);
    else byExam.set(q.examId, { title: q.examTitle, questions: [q] });
  }

  return (
    <section>
      <SectionHeading
        label="Exam có atom này"
        count={items.length}
        icon={<Icon className="h-3.5 w-3.5" />}
      />
      <ul className="space-y-1.5">
        {Array.from(byExam.entries()).map(([examId, info]) => (
          <li
            key={examId}
            className="flex items-center gap-3 rounded-lg border border-divider bg-card p-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{info.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {info.questions.length} câu
              </p>
            </div>
            <Link
              href={`/exams/${examId}`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-divider bg-card px-2.5 text-[11px] text-muted-foreground hover:border-primary/30 hover:text-primary"
            >
              Xem exam
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionHeading({
  label,
  count,
  icon,
  children,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
        {icon}
        {label}
        <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
          {count}
        </span>
      </h2>
      {children}
    </div>
  );
}
