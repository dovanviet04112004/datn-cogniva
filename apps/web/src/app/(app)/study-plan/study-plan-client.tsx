/**
 * StudyPlanClient — phần TƯƠNG TÁC của /study-plan (client island).
 *
 * Trang là Server Component (page.tsx) prefetch initial data → truyền xuống đây
 * làm `initialData` cho useQuery → first paint có data ngay, KHÔNG skeleton.
 * Toàn bộ optimistic mutation (toggle/skip/delete) + dialog tạo todo vẫn ở client.
 *
 * Trước Phase B: trang này chỉ là todo list trống chờ user gõ. Sau Phase B:
 *   - Top: "Hôm nay" — AI proposal 3 nhóm (Ôn / Atom mới / Quiz yếu)
 *   - Bottom: "Todo cá nhân" — manual items user tự gõ (giữ logic cũ)
 *
 * Spec: docs/plans/atom-centric.md §5.5 + §6 Phase B.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Calendar,
  Check,
  GraduationCap,
  ListChecks,
  Repeat,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { PageShell } from '@/components/layout/page-shell';
// Hero band CHUNG — thay header "hôm nay" tự-chế để đồng bộ ngôn ngữ hero toàn app.
import { PageHero } from '@/components/layout/page-hero';
import { EmptyState } from '@/components/layout/empty-state';
import { PageLoading } from '@/components/layout/page-loading';
import { CreateStudyItemDialog } from '@/components/study-plan/create-study-item-dialog';
import { NeuralPattern } from '@/components/ui/neural-pattern';
// Tiêu đề mục dùng chung toàn app (thay khối eyebrow gạch hardcode cũ).
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';
import { type Item, type ItemStatus, normalizeItem } from '@/lib/study-plan/item';

export function StudyPlanClient({ initialItems }: { initialItems?: Item[] }) {
  const qc = useQueryClient();
  // React Query: gộp today proposal + manual items (Promise.all) thành 1 list.
  // initialData = data SSR prefetch → không skeleton lần đầu, vẫn revalidate.
  // Nếu SSR prefetch lỗi (initialItems undefined) → không có initialData →
  // useQuery tự fetch qua API (có skeleton, degrade như bản client cũ).
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: qk.studyPlan(),
    initialData: initialItems,
    queryFn: async () => {
      const [todayRes, manualRes] = await Promise.all([
        apiGet<{ items?: unknown[] }>('/api/study-plan/today'),
        apiGet<{ items?: unknown[] }>('/api/study-plan?kind=manual'),
      ]);
      const todayItems = (todayRes.items ?? []).map(normalizeItem);
      const manualItems = (manualRes.items ?? []).map(normalizeItem);
      return [...todayItems, ...manualItems];
    },
  });

  // Helper: optimistic update THẲNG vào cache (giữ nguyên các handler dạng functional).
  const setItems = (action: React.SetStateAction<Item[]>) =>
    qc.setQueryData<Item[]>(qk.studyPlan(), (cur) => {
      const prev = cur ?? [];
      return typeof action === 'function'
        ? (action as (p: Item[]) => Item[])(prev)
        : action;
    });
  const refresh = () => qc.invalidateQueries({ queryKey: qk.studyPlan() });

  const toggleStatus = async (it: Item) => {
    const next: ItemStatus = it.status === 'PENDING' ? 'DONE' : 'PENDING';
    setItems((cur) =>
      cur.map((x) =>
        x.id === it.id
          ? {
              ...x,
              status: next,
              completedAt: next === 'DONE' ? new Date().toISOString() : null,
            }
          : x,
      ),
    );
    try {
      await apiSend(`/api/study-plan/${it.id}`, 'PATCH', { status: next });
    } catch (err) {
      toast.error('Update thất bại: ' + (err as Error).message);
    }
  };

  const skipItem = async (it: Item) => {
    setItems((cur) =>
      cur.map((x) =>
        x.id === it.id
          ? { ...x, status: 'SKIPPED', completedAt: new Date().toISOString() }
          : x,
      ),
    );
    try {
      await apiSend(`/api/study-plan/${it.id}/skip`, 'POST');
    } catch (err) {
      toast.error('Skip thất bại: ' + (err as Error).message);
      refresh();
    }
  };

  const deleteItem = async (id: string) => {
    try {
      await apiSend(`/api/study-plan/${id}`, 'DELETE');
      setItems((cur) => cur.filter((x) => x.id !== id));
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    }
  };

  const proposalPending = items.filter(
    (i) => i.kind !== 'manual' && i.status === 'PENDING',
  );
  const review = proposalPending.filter((i) => i.kind === 'review');
  const newAtoms = proposalPending.filter((i) => i.kind === 'new');
  const practice = proposalPending.filter((i) => i.kind === 'practice');

  const manualItems = items.filter((i) => i.kind === 'manual');
  const manualPending = manualItems.filter((i) => i.status === 'PENDING');
  const manualDone = manualItems.filter((i) => i.status === 'DONE');
  const overdueCount = manualPending.filter(
    (i) => i.dueDate && new Date(i.dueDate).getTime() < Date.now(),
  ).length;

  const totalProposalMinutes = proposalPending.reduce(
    (sum, i) => sum + (i.metadata.estimatedMinutes ?? 3),
    0,
  );

  return (
    <PageShell size="wide" padded className="space-y-10">
      {/* ══ Hero band CHUNG — giữ motif NeuralPattern + status chips (AI đề xuất / quá hạn) ══ */}
      <PageHero
        eyebrow="Study Plan · Hôm nay"
        eyebrowIcon={GraduationCap}
        title="Kế hoạch học hôm nay"
        description={
          <>
            AI đề xuất atom cần ôn (SRS due) + atom mới + quiz củng cố. Tick xong
            hoặc bỏ qua hôm nay. Phía dưới là todo cá nhân nếu cần.
            {/* Status chips GIỮ nguyên logic — đặt dưới description trong hero. */}
            {(proposalPending.length > 0 || overdueCount > 0) && (
              <span className="mt-3 flex flex-wrap gap-2">
                {proposalPending.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                    <Sparkles className="h-3 w-3" />
                    <span className="font-mono tabular-nums">
                      {proposalPending.length}
                    </span>{' '}
                    AI đề xuất · ~{totalProposalMinutes} phút
                  </span>
                )}
                {overdueCount > 0 && (
                  // Quá hạn = trạng thái tiêu cực → token destructive (thay red-500 hardcode)
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/20 bg-destructive/5 px-2.5 py-1 text-xs font-medium text-destructive">
                    <Calendar className="h-3 w-3" />
                    <span className="font-mono tabular-nums">{overdueCount}</span>{' '}
                    quá hạn
                  </span>
                )}
              </span>
            )}
          </>
        }
        decoration={
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-2/3 [mask-image:radial-gradient(ellipse_at_right,_black_25%,_transparent_75%)]"
          >
            <NeuralPattern className="text-primary opacity-[0.18]" />
          </div>
        }
      >
        {/* GIỮ nguyên action — nút tạo todo. */}
        <CreateStudyItemDialog onCreated={refresh} />
      </PageHero>

      {loading && <PageLoading variant="skeleton" rows={3} />}

      {/* ══ AI proposal sections ══════════════════════════════ */}
      {!loading && (
        <>
          {proposalPending.length === 0 && manualItems.length === 0 ? (
            <EmptyState
              title="Chưa có gì để học hôm nay"
              description="Upload PDF + đợi AI extract atom (30-60s) → quay lại đây sẽ thấy đề xuất. Hoặc tự thêm todo bên dưới."
            />
          ) : (
            <>
              {proposalPending.length === 0 ? (
                <section className="rounded-xl border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                  Không có atom nào cần review/học hôm nay. Quay lại sau khi upload
                  thêm tài liệu.
                </section>
              ) : (
                <div className="space-y-6">
                  <ProposalSection
                    icon={<Repeat className="h-3.5 w-3.5" />}
                    label="Ôn tập (SRS due)"
                    description="Atom đến hạn ôn — review trước khi quên"
                    items={review}
                    onDone={toggleStatus}
                    onSkip={skipItem}
                    accent="emerald"
                  />
                  <ProposalSection
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    label="Atom mới"
                    description="Mở rộng kiến thức từ tài liệu của bạn"
                    items={newAtoms}
                    onDone={toggleStatus}
                    onSkip={skipItem}
                    accent="blue"
                  />
                  <ProposalSection
                    icon={<ListChecks className="h-3.5 w-3.5" />}
                    label="Quiz củng cố"
                    description="Atom yếu (mastery < 50%) — luyện thêm"
                    items={practice}
                    onDone={toggleStatus}
                    onSkip={skipItem}
                    accent="amber"
                  />
                </div>
              )}

              {/* ══ Manual todo (legacy) ══════════════════════════ */}
              {(manualPending.length > 0 || manualDone.length > 0) && (
                <div className="space-y-4 border-t pt-8">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-sm font-semibold tracking-tight">
                      Todo cá nhân
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Mục tự gõ — không phải AI đề xuất
                    </p>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2">
                    <section>
                      <SectionHeading count={manualPending.length}>Cần làm</SectionHeading>
                      {manualPending.length === 0 ? (
                        <EmptyState
                          variant="inline"
                          title="Không có todo pending"
                          description="Hoàn thành hết — tuyệt!"
                        />
                      ) : (
                        <ul className="space-y-2">
                          {manualPending.map((it) => (
                            <ManualItemCard
                              key={it.id}
                              item={it}
                              onToggle={() => toggleStatus(it)}
                              onDelete={() => deleteItem(it.id)}
                            />
                          ))}
                        </ul>
                      )}
                    </section>
                    <section>
                      <SectionHeading count={manualDone.length}>Đã xong</SectionHeading>
                      {manualDone.length === 0 ? (
                        <EmptyState
                          variant="inline"
                          title="Chưa có gì xong"
                          description="Tick checkbox bên trái khi xong."
                        />
                      ) : (
                        <ul className="space-y-2">
                          {manualDone.map((it) => (
                            <ManualItemCard
                              key={it.id}
                              item={it}
                              onToggle={() => toggleStatus(it)}
                              onDelete={() => deleteItem(it.id)}
                            />
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </PageShell>
  );
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

/**
 * Bảng màu accent CÓ CHỦ ĐÍCH để phân biệt 3 nhóm đề xuất (ôn / atom mới / quiz).
 * GIỮ Tailwind palette trực tiếp theo design-system §2.5 (1 domain = 1 màu xuyên
 * suốt: emerald = ôn tập/flashcard, blue = tài liệu/atom mới). Không ép sang token
 * semantic vì: (1) blue chưa có token → sẽ lệch nhịp; (2) cần tint /20 /5 + dark:
 * variant mà token hex đặc không tái tạo được.
 */
const ACCENT_CLASS: Record<string, string> = {
  emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
  blue: 'border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400',
  amber: 'border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400',
};

function ProposalSection({
  icon,
  label,
  description,
  items,
  onDone,
  onSkip,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  items: Item[];
  onDone: (it: Item) => void;
  onSkip: (it: Item) => void;
  accent: 'emerald' | 'blue' | 'amber';
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider',
            ACCENT_CLASS[accent],
          )}
        >
          {icon}
          {label}
          <span className="font-mono">{items.length}</span>
        </span>
        <span className="text-[11px] text-muted-foreground">{description}</span>
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <ProposalItemCard
            key={it.id}
            item={it}
            onDone={() => onDone(it)}
            onSkip={() => onSkip(it)}
          />
        ))}
      </ul>
    </section>
  );
}

function ProposalItemCard({
  item,
  onDone,
  onSkip,
}: {
  item: Item;
  onDone: () => void;
  onSkip: () => void;
}) {
  const mins = item.metadata.estimatedMinutes ?? 3;
  // Link đích "Bắt đầu" theo kind
  const startHref =
    item.kind === 'review'
      ? '/flashcards'
      : item.kind === 'practice'
        ? '/quiz'
        : item.conceptId
          ? `/graph?node=${item.conceptId}`
          : '#';

  return (
    <li className="group/item flex items-start gap-3 rounded-xl border border-divider bg-card p-3.5 shadow-soft transition-all duration-base ease-expo-out hover:-translate-y-0.5 hover:shadow-elevated">
      {/* Done checkbox */}
      <button
        onClick={onDone}
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-surface transition-all hover:border-primary hover:bg-primary/5"
        aria-label="Đánh dấu xong"
        title="Đánh dấu xong"
      >
        <Check className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover/item:opacity-40" strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium tracking-tight">{item.title}</p>
        {item.metadata.previewQuestion && (
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium">Q:</span> {item.metadata.previewQuestion}
          </p>
        )}
        {!item.metadata.previewQuestion && item.description && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        )}
        {/* Metadata row → cỡ chữ chuẩn text-[11px] (thay 10.5px lẻ) */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono">~{mins} phút</span>
          {item.metadata.atomDomain && (
            <>
              <span>·</span>
              <span className="font-mono">{item.metadata.atomDomain}</span>
            </>
          )}
          {typeof item.metadata.masteryScore === 'number' && (
            <>
              <span>·</span>
              <span className="font-mono">
                mastery {(item.metadata.masteryScore * 100).toFixed(0)}%
              </span>
            </>
          )}
          {item.metadata.flashcardCount! > 0 && (
            <>
              <span>·</span>
              <span>{item.metadata.flashcardCount} card</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <Link
          href={startHref}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 text-[11px] font-medium text-primary hover:bg-primary/10"
        >
          Bắt đầu
        </Link>
        <button
          onClick={onSkip}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Bỏ qua hôm nay"
          title="Bỏ qua hôm nay"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function ManualItemCard({
  item,
  onToggle,
  onDelete,
}: {
  item: Item;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const isDone = item.status === 'DONE';
  const overdue =
    !isDone && item.dueDate && new Date(item.dueDate).getTime() < Date.now();

  return (
    <li
      className={cn(
        'group/item flex items-start gap-3 rounded-xl border border-divider bg-card p-3.5 shadow-soft transition-all duration-base ease-expo-out',
        !isDone && 'hover:-translate-y-0.5 hover:shadow-elevated',
        isDone && 'opacity-70',
      )}
    >
      <button
        onClick={onToggle}
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-base ease-expo-out',
          isDone
            ? // Đã xong = trạng thái positive → token success (thay emerald-500 hardcode)
              'border-success bg-success text-success-foreground shadow-soft'
            : 'border-border bg-surface hover:border-primary hover:bg-primary/5',
        )}
        aria-label={isDone ? 'Đánh dấu pending' : 'Đánh dấu xong'}
      >
        {isDone && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-medium tracking-tight transition-colors',
            isDone && 'text-muted-foreground line-through',
          )}
        >
          {item.title}
        </p>
        {item.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
        )}
        {item.dueDate && (
          <div className="mt-1.5 inline-flex items-center gap-1.5">
            {overdue ? (
              // Badge quá hạn = trạng thái tiêu cực → token destructive (thay red-500 hardcode)
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/20 bg-destructive/5 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">
                <Calendar className="h-2.5 w-2.5" />
                Quá hạn ·{' '}
                <span className="font-mono tabular-nums">
                  {new Date(item.dueDate).toLocaleDateString('vi-VN')}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="h-2.5 w-2.5" />
                <span className="font-mono tabular-nums">
                  {new Date(item.dueDate).toLocaleDateString('vi-VN')}
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      <button
        onClick={onDelete}
        className="opacity-0 transition-opacity group-hover/item:opacity-100 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label="Xoá"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
