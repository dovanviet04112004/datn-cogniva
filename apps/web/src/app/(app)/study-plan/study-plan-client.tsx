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
import { EmptyState } from '@/components/ui/empty-state';
import { PageLoading } from '@/components/layout/page-loading';
import { CreateStudyItemDialog } from '@/components/study-plan/create-study-item-dialog';
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';
import { type Item, type ItemStatus, normalizeItem } from '@/lib/study-plan/item';

export function StudyPlanClient({ initialItems }: { initialItems?: Item[] }) {
  const qc = useQueryClient();
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

  const setItems = (action: React.SetStateAction<Item[]>) =>
    qc.setQueryData<Item[]>(qk.studyPlan(), (cur) => {
      const prev = cur ?? [];
      return typeof action === 'function' ? (action as (p: Item[]) => Item[])(prev) : action;
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
        x.id === it.id ? { ...x, status: 'SKIPPED', completedAt: new Date().toISOString() } : x,
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

  const proposalPending = items.filter((i) => i.kind !== 'manual' && i.status === 'PENDING');
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
    <PageShell
      size="wide"
      padded
      className="space-y-10"
      eyebrowIcon={GraduationCap}
      title="Kế hoạch học hôm nay"
      description="AI đề xuất atom cần ôn (SRS due) + atom mới + quiz củng cố — tick xong hoặc bỏ qua hôm nay."
      action={
        <div className="flex items-center gap-2">
          {proposalPending.length > 0 && (
            <span className="border-primary/20 bg-primary/5 text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
              <Sparkles className="h-3 w-3" />
              <span className="font-mono tabular-nums">{proposalPending.length}</span> AI đề xuất ·
              ~{totalProposalMinutes} phút
            </span>
          )}
          {overdueCount > 0 && (
            <span className="border-destructive/20 bg-destructive/5 text-destructive inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
              <Calendar className="h-3 w-3" />
              <span className="font-mono tabular-nums">{overdueCount}</span> quá hạn
            </span>
          )}
          <CreateStudyItemDialog onCreated={refresh} />
        </div>
      }
    >
      {loading && <PageLoading variant="skeleton" rows={3} />}

      {!loading && (
        <>
          {proposalPending.length === 0 && manualItems.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="Chưa có gì để học hôm nay"
              description="Upload PDF + đợi AI extract atom (30-60s) → quay lại đây sẽ thấy đề xuất. Hoặc tự thêm todo bên dưới."
            />
          ) : (
            <>
              {proposalPending.length === 0 ? (
                <section className="bg-muted/20 text-muted-foreground rounded-xl border p-4 text-center text-sm">
                  Không có atom nào cần review/học hôm nay. Quay lại sau khi upload thêm tài liệu.
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

              {(manualPending.length > 0 || manualDone.length > 0) && (
                <div className="space-y-4 border-t pt-8">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-sm font-semibold tracking-tight">Todo cá nhân</h2>
                    <p className="text-muted-foreground text-xs">
                      Mục tự gõ — không phải AI đề xuất
                    </p>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2">
                    <section>
                      <SectionHeading count={manualPending.length}>Cần làm</SectionHeading>
                      {manualPending.length === 0 ? (
                        <EmptyState
                          compact
                          icon={Check}
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
                          compact
                          icon={ListChecks}
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
        <span className="text-muted-foreground text-[11px]">{description}</span>
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
  const startHref =
    item.kind === 'review'
      ? '/flashcards'
      : item.kind === 'practice'
        ? '/quiz'
        : item.conceptId
          ? `/graph?node=${item.conceptId}`
          : '#';

  return (
    <li className="group/item border-divider bg-card shadow-soft duration-base ease-expo-out hover:shadow-elevated flex items-start gap-3 rounded-xl border p-3.5 transition-all hover:-translate-y-0.5">
      <button
        onClick={onDone}
        className="border-border bg-surface hover:border-primary hover:bg-primary/5 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all"
        aria-label="Đánh dấu xong"
        title="Đánh dấu xong"
      >
        <Check
          className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover/item:opacity-40"
          strokeWidth={3}
        />
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium tracking-tight">{item.title}</p>
        {item.metadata.previewQuestion && (
          <p className="text-muted-foreground mt-1 text-xs">
            <span className="font-medium">Q:</span> {item.metadata.previewQuestion}
          </p>
        )}
        {!item.metadata.previewQuestion && item.description && (
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{item.description}</p>
        )}
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-[11px]">
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
          className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium"
        >
          Bắt đầu
        </Link>
        <button
          onClick={onSkip}
          className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded-md"
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
  const overdue = !isDone && item.dueDate && new Date(item.dueDate).getTime() < Date.now();

  return (
    <li
      className={cn(
        'group/item border-divider bg-card shadow-soft duration-base ease-expo-out flex items-start gap-3 rounded-xl border p-3.5 transition-all',
        !isDone && 'hover:shadow-elevated hover:-translate-y-0.5',
        isDone && 'opacity-70',
      )}
    >
      <button
        onClick={onToggle}
        className={cn(
          'duration-base ease-expo-out mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all',
          isDone
            ? 'border-success bg-success text-success-foreground shadow-soft'
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
          <p className="text-muted-foreground mt-0.5 text-xs">{item.description}</p>
        )}
        {item.dueDate && (
          <div className="mt-1.5 inline-flex items-center gap-1.5">
            {overdue ? (
              <span className="border-destructive/20 bg-destructive/5 text-destructive inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold">
                <Calendar className="h-2.5 w-2.5" />
                Quá hạn ·{' '}
                <span className="font-mono tabular-nums">
                  {new Date(item.dueDate).toLocaleDateString('vi-VN')}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
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
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex h-7 w-7 items-center justify-center rounded-lg opacity-0 transition-opacity group-hover/item:opacity-100"
        aria-label="Xoá"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
