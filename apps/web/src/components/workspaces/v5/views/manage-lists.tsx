'use client';

import * as React from 'react';
import { Check, Loader2, X as XIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import type {
  ManageFlashcardDTO,
  ManageQuestionDTO,
  WorkspaceManageDTO,
} from '@cogniva/shared/types';

import { cn } from '@/lib/utils';

type Filter = 'all' | 'done' | 'todo';

function useManage(workspaceId: string) {
  return useQuery({
    queryKey: qk.workspaceManage(workspaceId),
    queryFn: () => apiGet<WorkspaceManageDTO>(`/api/workspaces/${workspaceId}/manage`),
  });
}

function FilterBar({
  filter,
  setFilter,
  doneLabel,
  todoLabel,
}: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  doneLabel: string;
  todoLabel: string;
}) {
  const opts: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Tất cả' },
    { key: 'done', label: doneLabel },
    { key: 'todo', label: todoLabel },
  ];
  return (
    <div className="flex gap-1">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => setFilter(o.key)}
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
            filter === o.key
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AtomChip({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span className="bg-primary/8 text-primary inline-flex max-w-[130px] items-center truncate rounded px-1.5 py-0.5 text-[10px] font-medium">
      {name}
    </span>
  );
}

function DoneBadge({
  done,
  doneLabel,
  todoLabel,
}: {
  done: boolean;
  doneLabel: string;
  todoLabel: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
        done ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
      )}
    >
      {done && <Check className="h-2.5 w-2.5" />}
      {done ? doneLabel : todoLabel}
    </span>
  );
}

function ListShell({
  title,
  count,
  filter,
  setFilter,
  doneLabel,
  todoLabel,
  loading,
  empty,
  children,
}: {
  title: string;
  count: number;
  filter: Filter;
  setFilter: (f: Filter) => void;
  doneLabel: string;
  todoLabel: string;
  loading: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-muted/20 rounded-md border p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
          {title} ({count})
        </h3>
        <FilterBar
          filter={filter}
          setFilter={setFilter}
          doneLabel={doneLabel}
          todoLabel={todoLabel}
        />
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        </div>
      ) : empty ? (
        <p className="text-muted-foreground py-3 text-center text-[11px]">Không có mục nào.</p>
      ) : (
        <ul className="max-h-[36vh] space-y-1 overflow-y-auto pr-0.5">{children}</ul>
      )}
    </div>
  );
}

export function FlashcardManageList({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useManage(workspaceId);
  const [filter, setFilter] = React.useState<Filter>('all');
  const cards = data?.flashcards ?? [];
  const filtered = cards.filter((c) =>
    filter === 'all' ? true : filter === 'done' ? c.done : !c.done,
  );
  return (
    <ListShell
      title="Thẻ đã tạo"
      count={cards.length}
      filter={filter}
      setFilter={setFilter}
      doneLabel="Đã ôn"
      todoLabel="Chưa ôn"
      loading={isLoading}
      empty={filtered.length === 0}
    >
      {filtered.map((f: ManageFlashcardDTO) => (
        <li key={f.id} className="bg-card flex items-start gap-2 rounded-md border px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-foreground/90 truncate text-[12px] font-medium" title={f.front}>
              {f.front}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <AtomChip name={f.atomName} />
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
                {f.cardType}
              </span>
            </div>
          </div>
          <DoneBadge done={f.done} doneLabel="Đã ôn" todoLabel="Chưa ôn" />
        </li>
      ))}
    </ListShell>
  );
}

export function QuestionManageList({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useManage(workspaceId);
  const [filter, setFilter] = React.useState<Filter>('all');
  const questions = data?.questions ?? [];
  const filtered = questions.filter((q) =>
    filter === 'all' ? true : filter === 'done' ? q.done : !q.done,
  );
  return (
    <ListShell
      title="Câu hỏi đã tạo"
      count={questions.length}
      filter={filter}
      setFilter={setFilter}
      doneLabel="Đã làm"
      todoLabel="Chưa làm"
      loading={isLoading}
      empty={filtered.length === 0}
    >
      {filtered.map((q: ManageQuestionDTO) => (
        <li key={q.id} className="bg-card flex items-start gap-2 rounded-md border px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-foreground/90 truncate text-[12px] font-medium" title={q.prompt}>
              {q.prompt}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <AtomChip name={q.atomName} />
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
                {q.type}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {q.done &&
              (q.lastCorrect === true ? (
                <Check className="text-success h-3.5 w-3.5" />
              ) : q.lastCorrect === false ? (
                <XIcon className="text-destructive h-3.5 w-3.5" />
              ) : null)}
            <DoneBadge done={q.done} doneLabel="Đã làm" todoLabel="Chưa làm" />
          </div>
        </li>
      ))}
    </ListShell>
  );
}
