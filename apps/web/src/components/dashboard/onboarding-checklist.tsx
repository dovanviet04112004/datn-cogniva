'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  BrainCircuit,
  Check,
  MessageSquare,
  Sparkles,
  Upload,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CreateWorkspaceDialog } from '@/components/workspaces/create-workspace-dialog';
import { UploadDocumentDialog } from '@/components/documents/upload-document-dialog';
import { ExploreGrid } from '@/components/dashboard/explore-grid';

type StepDef = {
  done: boolean;
  icon: LucideIcon;
  title: string;
  desc: string;
  action: React.ReactNode;
};

export function OnboardingChecklist({
  hasWorkspace,
  hasDocs,
  hasChat,
  hasFlashcards,
  tutorHref,
  flashcardHref,
}: {
  hasWorkspace: boolean;
  hasDocs: boolean;
  hasChat: boolean;
  hasFlashcards: boolean;
  tutorHref: string;
  flashcardHref: string;
}) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const dismiss = () => {
    document.cookie = 'cogniva_ob_done=1; path=/; max-age=31536000; samesite=lax';
    router.refresh();
  };

  const [optWorkspace, setOptWorkspace] = React.useState(false);
  const [optDocs, setOptDocs] = React.useState(false);

  const steps: StepDef[] = [
    {
      done: hasWorkspace || optWorkspace,
      icon: BookOpen,
      title: 'Tạo workspace đầu tiên',
      desc: 'Workspace gom tài liệu theo môn/dự án — AI chỉ trả lời trong phạm vi đó.',
      action: (
        <CreateWorkspaceDialog
          onCreated={() => {
            setOptWorkspace(true);
            router.refresh();
          }}
        />
      ),
    },
    {
      done: hasDocs || optDocs,
      icon: Upload,
      title: 'Upload tài liệu',
      desc: 'Thả PDF vào — Cogniva parse + index để bạn hỏi đáp có citation.',
      action: (
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4" />
          Upload PDF
        </Button>
      ),
    },
    {
      done: hasChat,
      icon: MessageSquare,
      title: 'Hỏi AI Tutor',
      desc: 'Chat với AI theo đúng tài liệu trong workspace của bạn.',
      action: (
        <Button asChild size="sm">
          <Link href={tutorHref}>
            <MessageSquare className="h-4 w-4" />
            Mở khung chat
          </Link>
        </Button>
      ),
    },
    {
      done: hasFlashcards,
      icon: BrainCircuit,
      title: 'Tạo & ôn flashcard',
      desc: 'Vào workspace, chọn atom ở cột Sources rồi bấm "Tạo thẻ" ở Studio — ôn theo lịch FSRS để nhớ lâu.',
      action: (
        <Button asChild size="sm">
          <Link href={flashcardHref}>
            <BrainCircuit className="h-4 w-4" />
            Mở workspace để tạo
          </Link>
        </Button>
      ),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const currentIdx = steps.findIndex((s) => !s.done);

  const RING_R = 18;
  const RING_C = 2 * Math.PI * RING_R;
  const pct = doneCount / steps.length;

  return (
    <section className="animate-fade-in-up [animation-delay:80ms]">
      <div className="border-divider bg-card shadow-soft relative overflow-hidden rounded-2xl border">
        <div
          aria-hidden
          className="via-primary/25 pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
        />
        <div
          aria-hidden
          className="bg-primary/10 pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full blur-3xl"
        />

        <div className="border-divider relative flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Bắt đầu với Cogniva</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {doneCount === 0
                ? 'Vài bước để sẵn sàng học cùng AI.'
                : doneCount === steps.length
                  ? 'Hoàn tất — bạn đã sẵn sàng! 🎉'
                  : `Còn ${steps.length - doneCount} bước nữa là xong.`}
            </p>
          </div>
          <div
            className="relative h-12 w-12 shrink-0"
            role="img"
            aria-label={`Hoàn thành ${doneCount} trên ${steps.length} bước`}
          >
            <svg viewBox="0 0 44 44" className="h-12 w-12 -rotate-90">
              <circle
                cx="22"
                cy="22"
                r={RING_R}
                fill="none"
                strokeWidth="4"
                className="stroke-muted"
              />
              <circle
                cx="22"
                cy="22"
                r={RING_R}
                fill="none"
                strokeWidth="4"
                strokeLinecap="round"
                className="stroke-primary duration-slow ease-expo-out transition-all"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - pct)}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums">
              {doneCount}/{steps.length}
            </span>
          </div>
        </div>

        <ol>
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isCurrent = i === currentIdx;
            const isLast = i === steps.length - 1;
            const prevDone = i > 0 && steps[i - 1]!.done;
            return (
              <li
                key={step.title}
                className={cn(
                  'relative flex items-stretch gap-4 px-5 transition-colors sm:px-6',
                  isCurrent &&
                    'from-primary/[0.06] via-primary/[0.02] bg-gradient-to-r to-transparent',
                )}
              >
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'w-px flex-1',
                      i === 0 ? 'bg-transparent' : prevDone ? 'bg-primary/30' : 'bg-divider',
                    )}
                  />
                  <div
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all',
                      step.done
                        ? 'bg-primary text-primary-foreground ring-primary/30 shadow-soft ring-1 ring-inset'
                        : isCurrent
                          ? 'bg-primary/10 text-primary shadow-glow ring-primary/30 ring-2 ring-inset'
                          : 'bg-muted/50 text-muted-foreground/40 ring-divider ring-1 ring-inset',
                    )}
                  >
                    {step.done ? (
                      <Check className="h-5 w-5" strokeWidth={2.5} />
                    ) : (
                      <Icon className="h-5 w-5" strokeWidth={2} />
                    )}
                  </div>
                  <div
                    className={cn(
                      'w-px flex-1',
                      isLast ? 'bg-transparent' : step.done ? 'bg-primary/30' : 'bg-divider',
                    )}
                  />
                </div>

                <div className="flex min-w-0 flex-1 items-center gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    {isCurrent && (
                      <span className="text-primary mb-1 inline-block text-[10px] font-bold uppercase tracking-[0.14em]">
                        Bắt đầu tại đây
                      </span>
                    )}
                    <p
                      className={cn(
                        'text-sm font-semibold tracking-tight',
                        !step.done && !isCurrent && 'text-muted-foreground',
                      )}
                    >
                      {step.title}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      {step.desc}
                    </p>
                  </div>

                  <div className="shrink-0">
                    {step.done ? (
                      <span className="text-primary inline-flex items-center gap-1 text-xs font-medium">
                        <Check className="h-3.5 w-3.5" />
                        Xong
                      </span>
                    ) : isCurrent ? (
                      step.action
                    ) : (
                      <span className="border-divider text-muted-foreground/40 flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums">
                        {i + 1}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="border-divider border-t px-5 py-4 sm:px-6">
          <p className="text-muted-foreground mb-3 flex items-center gap-1.5 text-xs font-medium">
            <Sparkles className="text-discovery-500 h-3.5 w-3.5" />
            Cogniva còn có — bấm để khám phá
          </p>
          <ExploreGrid />
        </div>

        <div className="border-divider border-t px-5 py-2.5 text-right sm:px-6">
          <button
            type="button"
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
          >
            Bỏ qua, vào bảng điều khiển →
          </button>
        </div>
      </div>

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => {
          setOptDocs(true);
          router.refresh();
        }}
      />
    </section>
  );
}
