/**
 * OnboardingChecklist — màn "bắt đầu" cho user MỚI (chưa có dữ liệu).
 *
 * Vì sao tồn tại: nhồi 4 ô thống kê "0 / 0 / 0 / 0" + quick-action chung chung cho
 * người vừa vào app (chưa có gì) = vô nghĩa + chán. Dashboard phải STATE-AWARE:
 *   - User mới  → checklist dẫn từng bước (file này).
 *   - User đã hoạt động → số liệu thật + quick actions (ở page).
 *
 * Layout (first look — premium, không phẳng):
 *   1. Header: tiêu đề + VÒNG TIẾN ĐỘ tròn (SVG ring) thay thanh mảnh.
 *   2. TIMELINE STEPPER 4 bước: node nối bằng đường dọc (đã xong = primary,
 *      chưa = divider); bước HIỆN TẠI phát sáng (ring + glow) + nhãn "Bắt đầu tại
 *      đây" + nút hành động; bước sau = số thứ tự mờ.
 *   3. Dải "Cogniva còn có": preview chiều rộng hệ thống (kho tài liệu, graph,
 *      nhóm học, gia sư, đề thi, phòng học) — INFORMATIONAL, KHÔNG lặp nav sidebar
 *      (mở từ thanh bên), chỉ để new user cảm nhận chiều sâu, không bị "thấy mỏng".
 *
 * Thứ tự bước theo CẤU TRÚC app (mọi thứ nằm trong workspace):
 *   1. Tạo workspace đầu tiên → 2. Upload tài liệu → 3. Hỏi AI Tutor → 4. Ôn flashcard
 *
 * Mở dialog tạo-workspace / upload NGAY TẠI CHỖ (không rời trang).
 */
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
  /** Node hành động cho bước hiện tại (nút/dialog/link). */
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
  /** Đã có ≥1 flashcard chưa (signal thật, không phải xp>0). */
  hasFlashcards: boolean;
  /** Đích chat (route /workspaces/new-chat — tự tạo workspace nếu cần). */
  tutorHref: string;
  /** Đích "tạo flashcard" = workspace notebook (chọn atom → Studio tạo thẻ). */
  flashcardHref: string;
}) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = React.useState(false);

  // Bỏ qua onboarding: set cookie server-readable (đọc ở dashboard/page.tsx) →
  // tắt ngay sau refresh, không flicker. Luôn có lối thoát → không kẹt onboarding.
  const dismiss = () => {
    document.cookie = 'cogniva_ob_done=1; path=/; max-age=31536000; samesite=lax';
    router.refresh();
  };

  // Optimistic tick: 2 bước làm TẠI CHỖ (tạo workspace / upload) cập nhật NGAY khi
  // xong — không chờ vòng round-trip của router.refresh (bust cache → query DB →
  // re-render RSC) → cảm giác realtime. router.refresh vẫn chạy ngầm để đồng bộ
  // (prop server về true thì `prop || optimistic` vẫn true, không flicker ngược).
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
            setOptWorkspace(true); // tick NGAY, không chờ refresh
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
      // Sinh thẻ giờ DỒN về workspace (theo atom đang chọn), không tạo rời theo
      // tài liệu ngoài này nữa → chỉ deep-link vào workspace notebook.
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
  // Bước "hiện tại" = bước CHƯA xong đầu tiên (để highlight + hiện nút).
  const currentIdx = steps.findIndex((s) => !s.done);

  // Vòng tiến độ tròn — chu vi để tính strokeDashoffset (rotate -90 cho 12h start).
  const RING_R = 18;
  const RING_C = 2 * Math.PI * RING_R;
  const pct = doneCount / steps.length;

  return (
    <section className="animate-fade-in-up [animation-delay:80ms]">
      {/* bg ĐẶC (không /70 + KHÔNG backdrop-blur): card nằm trên nền đặc, blur chỉ
          tốn GPU + gây vệt seam ở dark mode (Chrome) chứ không blur gì. */}
      <div className="relative overflow-hidden rounded-2xl border border-divider bg-card shadow-soft">
        {/* Sheen + glow — chiều sâu premium ăn nhập với hero */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary/10 blur-3xl"
        />

        {/* ── Header + vòng tiến độ ── */}
        <div className="relative flex items-center justify-between gap-4 border-b border-divider px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Bắt đầu với Cogniva
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {doneCount === 0
                ? 'Vài bước để sẵn sàng học cùng AI.'
                : doneCount === steps.length
                  ? 'Hoàn tất — bạn đã sẵn sàng! 🎉'
                  : `Còn ${steps.length - doneCount} bước nữa là xong.`}
            </p>
          </div>
          {/* Ring tiến độ — đẹp + rõ hơn thanh mảnh */}
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
                className="stroke-primary transition-all duration-slow ease-expo-out"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - pct)}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums">
              {doneCount}/{steps.length}
            </span>
          </div>
        </div>

        {/* ── Timeline stepper ── */}
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
                  isCurrent && 'bg-gradient-to-r from-primary/[0.06] via-primary/[0.02] to-transparent',
                )}
              >
                {/* Rail icon + đường nối dọc (connector flex-1 trên/dưới node) */}
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
                        ? 'bg-primary text-primary-foreground ring-1 ring-inset ring-primary/30 shadow-soft'
                        : isCurrent
                          ? 'bg-primary/10 text-primary shadow-glow ring-2 ring-inset ring-primary/30'
                          : 'bg-muted/50 text-muted-foreground/40 ring-1 ring-inset ring-divider',
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

                {/* Nội dung + hành động */}
                <div className="flex min-w-0 flex-1 items-center gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    {isCurrent && (
                      <span className="mb-1 inline-block text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
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
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {step.desc}
                    </p>
                  </div>

                  {/* Hành động: chỉ bước HIỆN TẠI. Đã xong → "Xong"; sau → số thứ tự mờ. */}
                  <div className="shrink-0">
                    {step.done ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        <Check className="h-3.5 w-3.5" />
                        Xong
                      </span>
                    ) : isCurrent ? (
                      step.action
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-divider text-xs font-semibold tabular-nums text-muted-foreground/40">
                        {i + 1}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {/* ── Preview chiều rộng hệ thống — bấm vào thẳng từng khu ── */}
        <div className="border-t border-divider px-5 py-4 sm:px-6">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-discovery-500" />
            Cogniva còn có — bấm để khám phá
          </p>
          {/* Dùng chung ExploreGrid với dashboard → y hệt nhau (4 khu vào-thẳng-được). */}
          <ExploreGrid />
        </div>

        {/* Lối thoát — user không muốn làm đủ 4 bước vẫn vào thẳng dashboard được. */}
        <div className="border-t border-divider px-5 py-2.5 text-right sm:px-6">
          <button
            type="button"
            onClick={dismiss}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Bỏ qua, vào bảng điều khiển →
          </button>
        </div>
      </div>

      {/* Hộp thoại upload — mở từ bước 2 (controlled). Xong → refresh để tiến bước. */}
      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => {
          setOptDocs(true); // tick bước upload NGAY (optimistic), rồi refresh đồng bộ
          router.refresh();
        }}
      />
    </section>
  );
}
