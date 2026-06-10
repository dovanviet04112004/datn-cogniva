/**
 * ConciergePanel — V4 T1 (2026-05-22).
 *
 * Slide-in drawer panel bên phải cho AI Concierge tìm gia sư.
 * Layout: sub-header (thread switcher) + chat scroll + input.
 *
 * Features:
 *   - SSE stream từ POST /api/tutoring/concierge/threads/[id]/messages
 *   - 3 event types: text (char-by-char), tutors (array), action (clarify/search/no_match)
 *   - Suggestion chip dưới câu hỏi clarify — click auto-send
 *   - Thread switcher dropdown (lịch sử cuộc cũ)
 *   - Cmd+J shortcut mở panel
 *   - Empty state với 4 quick suggestion
 *
 * Spec: docs/plans/tutoring-v4.md §7.5.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  Loader2,
  Plus,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { TutorMatchCard } from './tutor-match-card';

type ThreadSummary = {
  id: string;
  title: string | null;
  lastMessageAt: string;
  extractedFilters: Record<string, unknown> | null;
};

type StoredMessage = {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  metadata: {
    action?: 'clarify' | 'search' | 'no_match' | 'tutor_detail' | 'faq';
    role?: 'student' | 'tutor';
    searchTarget?: 'tutor' | 'request';
    total?: number;
    filters?: Record<string, unknown>;
  } | null;
  /** V5.2: server-hydrated payload — restore cards/FAQ khi load lịch sử. */
  hydrated?: {
    tutors: TutorMatch[];
    requests: RequestMatch[];
    faqEntry: FaqEntry | null;
  };
  createdAt: string;
};

type LiveMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Khi đang stream, attach tutors array nếu có search action (student-side). */
  tutors?: TutorMatch[];
  /** Khi đang stream, attach requests array nếu là tutor-side search. */
  requests?: RequestMatch[];
  /** V5.1 deep Q&A — detail của 1 tutor + askAbout */
  tutorDetail?: TutorDetailPayload;
  tutorDetailAskAbout?: 'reviews' | 'availability' | 'price' | 'profile' | 'other';
  /** V5.2 FAQ — platform-level answer */
  faqEntry?: FaqEntry;
  /** V6 Library — doc cards inline. */
  libraryDocs?: LibraryDocMatch[];
  /** Action type cho UI hint chip dưới message. */
  action?: 'clarify' | 'search' | 'no_match' | 'tutor_detail' | 'faq' | 'library_search';
  /** Concierge role detect — UI render khác giữa student/tutor. */
  conciergeRole?: 'student' | 'tutor';
  /** Suggestion chips cho clarify question — click auto-send. */
  chips?: string[];
  /** Filter đã relax server-side (vd: ["hình thức","ngân sách"]). */
  relaxed?: string[];
};

export type TutorMatch = {
  id: string;
  userId: string;
  headline: string;
  hourlyRateVnd: number;
  modality: string;
  avatarUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: string;
  score: number;
  matchReason?: string;
};

/** Request match cho tutor-side concierge. */
export type RequestMatch = {
  id: string;
  studentId: string;
  studentName: string | null;
  title: string;
  description: string;
  subjectSlug: string;
  level: string;
  budgetVnd: number | null;
  modality: string;
  urgency: string;
  createdAt: string;
  score: number;
};

/** FAQ entry — V5.2 platform-level Q&A. */
export type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  cta?: { label: string; href: string };
};

/** Library doc card — V6 inline trong concierge. */
export type LibraryDocMatch = {
  id: string;
  title: string;
  subjectSlug: string;
  level: string;
  grade: number | null;
  docType: string;
  fileFormat: string;
  pageCount: number | null;
  previewThumbUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  workspaceImportCount: number;
  badges: string[];
};

/** Tutor detail event payload — V5.1 deep Q&A. */
export type TutorDetailPayload = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string;
  hourlyRateVnd: number;
  modality: string;
  ratingAvg: number | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: string;
  trialSessionEnabled: boolean;
  instantBookEnabled: boolean;
  avgResponseMinutes: number | null;
  reviews: Array<{
    id: string;
    rating: number;
    comment: string | null;
    tags: string[];
    helpfulCount: number;
    createdAt: string;
    reviewerName: string | null;
  }>;
};

const QUICK_SUGGESTIONS = [
  'Học Toán lớp 11 dưới 200k',
  'Luyện IELTS speaking 6.5+',
  'Học lập trình Python cho người mới',
  'Tiếng Anh giao tiếp online',
];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export function ConciergePanel({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [threads, setThreads] = React.useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<LiveMessage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [input, setInput] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  // Load thread list lần đầu mở
  React.useEffect(() => {
    if (!open) return;
    fetch('/api/tutoring/concierge/threads')
      .then((r) => (r.ok ? r.json() : { threads: [] }))
      .then((d: { threads: ThreadSummary[] }) => setThreads(d.threads ?? []))
      .catch(() => {});
  }, [open]);

  // Auto scroll bottom khi message thay đổi
  React.useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Cleanup stream khi panel đóng
  React.useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  /**
   * Load thread history (khi switch sang thread cũ).
   *
   * V5.2: Server đã hydrate sẵn tutor/request/FAQ payload qua `hydrated` field.
   * Client chỉ cần map sang LiveMessage để render đầy đủ card / bubble như khi
   * stream lần đầu — tránh user thấy "trống" sau khi reload thread.
   */
  const loadThread = async (threadId: string) => {
    setActiveThreadId(threadId);
    setLoading(true);
    setMessages([]);
    try {
      const res = await fetch(`/api/tutoring/concierge/threads/${threadId}/messages`);
      if (!res.ok) throw new Error('Load thread thất bại');
      const data = (await res.json()) as { messages: StoredMessage[] };
      const live: LiveMessage[] = data.messages
        .filter((m) => m.role !== 'tool')
        .map((m) => {
          const action = m.metadata?.action;
          // Map server action → LiveMessage action (chỉ subset enums hợp lệ)
          const liveAction:
            | 'clarify'
            | 'search'
            | 'no_match'
            | 'tutor_detail'
            | 'faq'
            | undefined =
            action === 'clarify' ||
            action === 'search' ||
            action === 'no_match' ||
            action === 'tutor_detail' ||
            action === 'faq'
              ? action
              : undefined;
          return {
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            tutors: m.hydrated?.tutors,
            requests: m.hydrated?.requests,
            faqEntry: m.hydrated?.faqEntry ?? undefined,
            action: liveAction,
            conciergeRole: m.metadata?.role,
          };
        });
      setMessages(live);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  /** Tạo thread mới — server trả thread id rồi gửi message ngay. */
  const createThread = async (firstMessage?: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/tutoring/concierge/threads', { method: 'POST' });
      if (!res.ok) throw new Error('Tạo thread thất bại');
      const data = (await res.json()) as { thread: ThreadSummary };
      setActiveThreadId(data.thread.id);
      setMessages([]);
      setThreads((prev) => [data.thread, ...prev]);
      if (firstMessage) {
        await sendMessage(data.thread.id, firstMessage);
      }
      return data.thread.id;
    } catch (err) {
      toast.error((err as Error).message);
      return null;
    }
  };

  /** Gửi message + stream SSE response. */
  const sendMessage = async (threadId: string, text: string) => {
    const userMsg: LiveMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    const assistantMsg: LiveMessage = {
      id: `local-${Date.now() + 1}`,
      role: 'assistant',
      content: '',
    };
    setMessages((prev) => [...prev, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/tutoring/concierge/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(
          (err as { error?: string } | null)?.error ?? 'Gửi message thất bại',
        );
      }

      // Parse SSE
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const eventBlock of events) {
          const lines = eventBlock.split('\n');
          const eventLine = lines.find((l) => l.startsWith('event:'));
          const dataLine = lines.find((l) => l.startsWith('data:'));
          if (!eventLine || !dataLine) continue;
          const eventName = eventLine.slice('event:'.length).trim();
          const dataStr = dataLine.slice('data:'.length).trim();
          let data: unknown;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }
          handleSseEvent(eventName, data, assistantMsg.id);
        }
      }

      // Stream kết thúc — đảm bảo bubble không bao giờ trống
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id && !m.content
            ? { ...m, content: '⚠ Không có phản hồi từ AI. Bạn thử gõ lại nhé.' }
            : m,
        ),
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      toast.error('Lỗi: ' + (err as Error).message);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: m.content || '⚠ Có lỗi, thử lại sau nhé.' }
            : m,
        ),
      );
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const handleSseEvent = (event: string, data: unknown, assistantId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m;
        switch (event) {
          case 'text':
            return { ...m, content: m.content + String(data) };
          case 'tutors':
            return { ...m, tutors: data as TutorMatch[] };
          case 'requests':
            return { ...m, requests: data as RequestMatch[] };
          case 'tutor_detail': {
            const d = data as {
              detail: TutorDetailPayload;
              askAbout: 'reviews' | 'availability' | 'price' | 'profile' | 'other';
            };
            return {
              ...m,
              tutorDetail: d.detail,
              tutorDetailAskAbout: d.askAbout,
            };
          }
          case 'faq': {
            const f = data as { entry: FaqEntry };
            return { ...m, faqEntry: f.entry };
          }
          case 'library_docs': {
            const ld = data as { docs: LibraryDocMatch[] };
            return { ...m, libraryDocs: ld.docs };
          }
          case 'action': {
            const a = data as {
              type:
                | 'clarify'
                | 'search'
                | 'no_match'
                | 'tutor_detail'
                | 'faq'
                | 'library_search';
              role?: 'student' | 'tutor';
              chips?: string[];
            };
            return {
              ...m,
              action: a.type,
              chips: a.chips,
              conciergeRole: a.role ?? m.conciergeRole,
            };
          }
          case 'relaxed': {
            const r = data as { dropped: string[] };
            return { ...m, relaxed: r.dropped };
          }
          case 'error': {
            // Backend cũng emit 'text' fallback, nhưng phòng trường hợp stream
            // bị cắt trước 'text' → đảm bảo bubble không trống.
            const e = data as { message?: string };
            if (!m.content) {
              return { ...m, content: `⚠ ${e.message ?? 'Có lỗi, thử lại sau nhé.'}` };
            }
            return m;
          }
          default:
            return m;
        }
      }),
    );
  };

  /** Submit user input. */
  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    if (!activeThreadId) {
      await createThread(text);
    } else {
      await sendMessage(activeThreadId, text);
    }
  };

  /** Click chip suggestion → auto-send. */
  const handleChip = async (chip: string) => {
    if (sending) return;
    if (!activeThreadId) {
      await createThread(chip);
    } else {
      await sendMessage(activeThreadId, chip);
    }
  };

  const handleNewThread = () => {
    abortRef.current?.abort();
    setActiveThreadId(null);
    setMessages([]);
    inputRef.current?.focus();
  };

  const activeThread = threads.find((t) => t.id === activeThreadId);

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-divider bg-card shadow-2xl transition-transform sm:w-[420px]',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
      role="dialog"
      aria-label="AI Concierge tìm gia sư"
      aria-hidden={!open}
    >
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-divider px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-discovery-500/15 text-discovery-500">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">AI Concierge</p>
          {activeThread?.title && (
            <p className="truncate text-[10.5px] text-muted-foreground">
              {activeThread.title}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2">
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={handleNewThread}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Cuộc trò chuyện mới
            </DropdownMenuItem>
            {threads.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Lịch sử
                </DropdownMenuLabel>
                {threads.slice(0, 8).map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => loadThread(t.id)}>
                    <span className="truncate text-xs">{t.title ?? '(Chưa đặt tên)'}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          onClick={() => onOpenChange(false)}
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label="Đóng"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1">
        <ScrollArea ref={scrollRef} className="h-full">
          <div className="space-y-3 px-3 py-3">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Đang tải…
              </div>
            )}

            {!loading && messages.length === 0 && <EmptyState onPick={handleChip} />}

            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                msg={m}
                isLast={i === messages.length - 1}
                onChipClick={handleChip}
                onCardClick={(tutorId) => {
                  onOpenChange(false);
                  router.push(`/tutors/${tutorId}`);
                }}
                onLibraryClick={(docId) => {
                  onOpenChange(false);
                  router.push(`/library/${docId}`);
                }}
              />
            ))}

            {sending && (
              <div className="flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-discovery-500" />
                <span className="animate-pulse">Đang tìm gia sư phù hợp...</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Input */}
      <footer className="shrink-0 border-t border-divider bg-background p-3">
        <div className="flex items-end gap-2 rounded-xl border border-input bg-surface px-3 py-2 transition-colors focus-within:border-discovery-500/40 focus-within:ring-4 focus-within:ring-discovery-500/10">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Hỏi mình về gia sư, môn học..."
            rows={1}
            maxLength={500}
            className="max-h-24 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            onClick={handleSubmit}
            disabled={!input.trim() || sending}
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            aria-label="Gửi"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/* ─── Empty state ─────────────────────────────────────────────────── */
function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-discovery-500/10 text-discovery-500">
        <Sparkles className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold">Tìm gia sư phù hợp</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Mình giúp bạn match gia sư trong 1 phút.
        </p>
      </div>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Thử bắt đầu
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {QUICK_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-full border border-divider bg-card px-3 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-discovery-500/40 hover:bg-discovery-500/5 hover:text-discovery-700"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Library Doc mini card (V6 in concierge) ──────────────────────── */
const DOC_TYPE_LABEL_MINI: Record<string, string> = {
  lecture_notes: 'Bài giảng',
  summary: 'Đề cương',
  exam: 'Đề thi',
  exercise: 'Bài tập',
  solution: 'Lời giải',
  reference_book: 'Tham khảo',
};

function LibraryDocMiniCard({
  doc,
  onOpen,
}: {
  doc: LibraryDocMatch;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/d flex w-full gap-2.5 rounded-xl border border-divider bg-card p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevated"
    >
      {/* Thumbnail */}
      <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
        {doc.previewThumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={doc.previewThumbUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-muted-foreground/60">
            {doc.fileFormat.toUpperCase()}
          </div>
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/40 text-center text-[7px] font-medium uppercase text-white/80">
          {doc.fileFormat}
        </span>
      </div>
      {/* Meta */}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[12px] font-semibold leading-tight">
          {doc.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <span className="rounded bg-muted px-1 py-0">
            {DOC_TYPE_LABEL_MINI[doc.docType] ?? doc.docType}
          </span>
          {doc.grade && (
            <>
              <span>·</span>
              <span>Lớp {doc.grade}</span>
            </>
          )}
          {doc.pageCount && (
            <>
              <span>·</span>
              <span>{doc.pageCount}p</span>
            </>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          {doc.ratingAvg ? (
            <span className="inline-flex items-center gap-0.5">
              ★ {doc.ratingAvg.toFixed(1)}
              <span className="opacity-60">({doc.ratingCount})</span>
            </span>
          ) : (
            <span className="italic opacity-60">Mới</span>
          )}
          {doc.workspaceImportCount > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span>📥 {doc.workspaceImportCount}</span>
            </>
          )}
          {doc.badges.includes('outcome_verified') && (
            <span className="rounded bg-amber-500/15 px-1 py-0 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              🏆 Verified
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ─── FAQ bubble (V5.2 platform Q&A) ──────────────────────────────── */
function FaqBubble({ entry }: { entry: FaqEntry }) {
  return (
    <div className="w-full rounded-xl border border-discovery-500/20 bg-discovery-500/5 p-3">
      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-discovery-500/20 text-[11px]">
          💡
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold leading-snug text-foreground/90">
            {entry.question}
          </p>
          {entry.cta && (
            // CTA primary qua <Button asChild> (tự có shadow-primary + focus-ring)
            <Button asChild size="sm" className="mt-2">
              <a href={entry.cta.href}>{entry.cta.label} →</a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Tutor detail bubble (V5.1 deep Q&A) ─────────────────────────── */
function TutorDetailBubble({
  detail,
  askAbout,
  onOpen,
}: {
  detail: TutorDetailPayload;
  askAbout?: 'reviews' | 'availability' | 'price' | 'profile' | 'other';
  onOpen: () => void;
}) {
  const showReviews = askAbout === 'reviews' || askAbout === 'profile' || !askAbout;
  return (
    <div className="w-full rounded-xl border border-divider bg-card p-3 shadow-soft">
      {/* Header — avatar + name + rating */}
      <div className="flex items-start gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-discovery-500/10 text-sm font-bold text-discovery-700 dark:text-discovery-300">
          {detail.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={detail.avatarUrl}
              alt={detail.name ?? ''}
              className="h-full w-full object-cover"
            />
          ) : (
            (detail.name ?? 'T')[0]?.toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{detail.name}</p>
          <p className="line-clamp-1 text-[10.5px] text-muted-foreground">
            {detail.headline}
          </p>
        </div>
        {detail.ratingAvg != null && (
          <div className="text-right">
            <p className="font-mono text-[12px] font-bold tabular-nums">
              ★ {detail.ratingAvg.toFixed(1)}
            </p>
            <p className="text-[9.5px] text-muted-foreground">
              {detail.ratingCount} review
            </p>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono font-semibold tabular-nums">
          {(detail.hourlyRateVnd / 1000).toLocaleString('vi-VN')}K/h
        </span>
        <span className="rounded-md bg-muted px-1.5 py-0.5">
          🏆 {detail.sessionsCompleted} buổi
        </span>
        {detail.verificationStatus === 'KYC_VERIFIED' && (
          <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">
            ✓ Verified
          </span>
        )}
        {detail.instantBookEnabled && (
          <span className="rounded-md bg-discovery-500/15 px-1.5 py-0.5 text-discovery-700 dark:text-discovery-300">
            ⚡ Đặt ngay
          </span>
        )}
        {detail.trialSessionEnabled && (
          <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-rose-700 dark:text-rose-300">
            🎁 Buổi thử
          </span>
        )}
        {detail.avgResponseMinutes != null && detail.avgResponseMinutes < 60 && (
          <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-sky-700 dark:text-sky-300">
            💬 {detail.avgResponseMinutes}p
          </span>
        )}
      </div>

      {/* Reviews — chỉ show khi askAbout = reviews | profile */}
      {showReviews && detail.reviews.length > 0 && (
        <div className="mt-2.5 space-y-1.5 border-t border-divider pt-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Review nổi bật
          </p>
          {detail.reviews.slice(0, 3).map((r) => (
            <div key={r.id} className="rounded-md bg-muted/40 p-2">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10.5px] font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {'★'.repeat(r.rating)}
                  <span className="text-muted-foreground/40">{'☆'.repeat(5 - r.rating)}</span>
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {r.reviewerName}
                </span>
              </div>
              {r.comment && (
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug">
                  {r.comment}
                </p>
              )}
              {r.tags && r.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="rounded bg-card px-1 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* CTA — primary qua <Button> mặc định, full-width giữ qua className */}
      <Button
        type="button"
        size="sm"
        onClick={onOpen}
        className="mt-3 w-full"
      >
        Xem profile đầy đủ →
      </Button>
    </div>
  );
}

/* ─── Request match card (tutor-side) ────────────────────────────── */
const URGENCY_LABEL: Record<string, { label: string; color: string }> = {
  ASAP: { label: 'Gấp', color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  THIS_WEEK: { label: 'Tuần này', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  THIS_MONTH: { label: 'Tháng này', color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  FLEXIBLE: { label: 'Linh hoạt', color: 'bg-muted text-muted-foreground' },
};

function RequestMatchCard({ request, rank }: { request: RequestMatch; rank: number }) {
  const urgency = URGENCY_LABEL[request.urgency] ?? URGENCY_LABEL.FLEXIBLE!;
  const budget = request.budgetVnd
    ? `${(request.budgetVnd / 1000).toLocaleString('vi-VN')}k/h`
    : 'Thoả thuận';
  return (
    <a
      href={`/tutoring/requests/${request.id}`}
      className="flex flex-col gap-1.5 rounded-xl border border-divider bg-card p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-discovery-500/30 hover:shadow-elevated"
    >
      <div className="flex items-start gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-discovery-500/15 text-[11px] font-bold text-discovery-700 dark:text-discovery-300">
          {rank + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[12.5px] font-semibold leading-tight">
            {request.title}
          </p>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${urgency.color}`}
        >
          {urgency.label}
        </span>
      </div>
      <p className="line-clamp-2 text-[11px] text-muted-foreground">
        {request.description}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-semibold tabular-nums">
          {budget}
        </span>
        <span>·</span>
        <span>{request.modality === 'ONLINE' ? 'Online' : request.modality === 'OFFLINE_HN' ? 'Offline HN' : request.modality === 'OFFLINE_HCM' ? 'Offline HCM' : 'Hybrid'}</span>
        {request.studentName && (
          <>
            <span>·</span>
            <span className="truncate">{request.studentName}</span>
          </>
        )}
      </div>
    </a>
  );
}

/* ─── Message bubble ──────────────────────────────────────────────── */
function MessageBubble({
  msg,
  isLast,
  onChipClick,
  onCardClick,
  onLibraryClick,
}: {
  msg: LiveMessage;
  isLast: boolean;
  onChipClick: (chip: string) => void;
  onCardClick: (tutorId: string) => void;
  onLibraryClick: (docId: string) => void;
}) {
  const isUser = msg.role === 'user';
  return (
    <div className={cn('flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[90%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed',
          isUser
            ? 'rounded-tr-sm bg-primary text-primary-foreground'
            : 'rounded-tl-sm bg-muted text-foreground',
        )}
      >
        {msg.content || (isLast ? <span className="opacity-60">...</span> : null)}
      </div>

      {/* Suggestion chips dưới câu hỏi clarify */}
      {!isUser && msg.chips && msg.chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {msg.chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onChipClick(chip)}
              className="rounded-full border border-divider bg-card px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-discovery-500/40 hover:bg-discovery-500/5"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Relaxed filter banner */}
      {!isUser && msg.relaxed && msg.relaxed.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          Mình đã mở rộng bộ lọc ({msg.relaxed.join(' · ')}) để hiển thị thêm gia sư gần khớp.
        </div>
      )}

      {/* Tutor match cards (student-side) */}
      {!isUser && msg.tutors && msg.tutors.length > 0 && (
        <div className="w-full space-y-2 pt-1">
          {msg.tutors.map((t, idx) => (
            <TutorMatchCard
              key={t.id}
              tutor={t}
              rank={idx}
              onOpen={() => onCardClick(t.id)}
            />
          ))}
        </div>
      )}

      {/* Request match cards (tutor-side) */}
      {!isUser && msg.requests && msg.requests.length > 0 && (
        <div className="w-full space-y-2 pt-1">
          {msg.requests.map((r, idx) => (
            <RequestMatchCard key={r.id} request={r} rank={idx} />
          ))}
        </div>
      )}

      {/* Tutor detail bubble — V5.1 deep Q&A */}
      {!isUser && msg.tutorDetail && (
        <div className="w-full pt-1">
          <TutorDetailBubble
            detail={msg.tutorDetail}
            askAbout={msg.tutorDetailAskAbout}
            onOpen={() => onCardClick(msg.tutorDetail!.id)}
          />
        </div>
      )}

      {/* FAQ bubble — V5.2 platform Q&A */}
      {!isUser && msg.faqEntry && (
        <div className="w-full pt-1">
          <FaqBubble entry={msg.faqEntry} />
        </div>
      )}

      {/* Library doc cards — V6 */}
      {!isUser && msg.libraryDocs && msg.libraryDocs.length > 0 && (
        <div className="w-full space-y-2 pt-1">
          {msg.libraryDocs.map((d) => (
            <LibraryDocMiniCard
              key={d.id}
              doc={d}
              onOpen={() => onLibraryClick(d.id)}
            />
          ))}
        </div>
      )}

      {/* No match action — 2 CTA */}
      {!isUser && msg.action === 'no_match' && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onChipClick('Đổi sang môn khác')}
            className="rounded-full border border-divider bg-card px-2.5 py-1 text-[11px] font-medium hover:border-discovery-500/40 hover:bg-discovery-500/5"
          >
            Đổi môn khác
          </button>
          <Link
            href="/tutoring/requests/new"
            className="inline-flex items-center gap-1 rounded-full border border-discovery-500/30 bg-discovery-500/5 px-3 py-1 text-[11.5px] font-medium text-discovery-700 hover:bg-discovery-500/10 dark:text-discovery-300"
          >
            Đăng yêu cầu để gia sư đề xuất
          </Link>
        </div>
      )}
    </div>
  );
}
