/**
 * /study-plan — list items + form tạo mới + tick checkbox toggle DONE.
 *
 * Layout:
 *   1. Form "Tạo mục mới" (collapsible)
 *   2. 2 cột: PENDING (todo) + DONE (đã hoàn thành) — desktop. Mobile: stack.
 *
 * Phase 7 v1 thuần CRUD; không có AI gợi ý lịch học (Phase 8+ join mastery
 * + due date của flashcard → đề xuất tự động).
 */
'use client';

import * as React from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

type Item = {
  id: string;
  title: string;
  description: string | null;
  status: 'PENDING' | 'DONE';
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
};

export default function StudyPlanPage() {
  const [items, setItems] = React.useState<Item[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');

  React.useEffect(() => {
    fetch('/api/study-plan')
      .then((r) => r.json())
      .then((d: { items: Item[] }) => setItems(d.items))
      .finally(() => setLoading(false));
  }, []);

  const createItem = async () => {
    if (!title.trim()) {
      toast.error('Cần tiêu đề');
      return;
    }
    try {
      const res = await fetch('/api/study-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { item: Item };
      setItems((cur) => [data.item, ...cur]);
      setTitle('');
      setDescription('');
      setDueDate('');
      setShowForm(false);
      toast.success('Đã tạo');
    } catch (err) {
      toast.error('Tạo thất bại: ' + (err as Error).message);
    }
  };

  const toggleStatus = async (it: Item) => {
    const next = it.status === 'PENDING' ? 'DONE' : 'PENDING';
    // Optimistic update
    setItems((cur) =>
      cur.map((x) =>
        x.id === it.id
          ? { ...x, status: next, completedAt: next === 'DONE' ? new Date().toISOString() : null }
          : x,
      ),
    );
    try {
      await fetch(`/api/study-plan/${it.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
    } catch (err) {
      toast.error('Update thất bại: ' + (err as Error).message);
    }
  };

  const deleteItem = async (id: string) => {
    try {
      const res = await fetch(`/api/study-plan/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setItems((cur) => cur.filter((x) => x.id !== id));
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    }
  };

  const pending = items.filter((i) => i.status === 'PENDING');
  const done = items.filter((i) => i.status === 'DONE');

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Study Plan</h1>
          <p className="text-sm text-muted-foreground">
            Kế hoạch học của bạn — tick check khi hoàn thành.
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
          {showForm ? 'Đóng' : 'Mục mới'}
        </Button>
      </div>

      {showForm && (
        <Card className="space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Tiêu đề</Label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Vd: Ôn chương Lamport clock"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Mô tả (optional)</Label>
            <textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due">Deadline (optional)</Label>
            <input
              id="due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <Button onClick={createItem} className="w-full">
            Tạo
          </Button>
        </Card>
      )}

      {loading && <p className="text-sm text-muted-foreground">Đang tải...</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Cần làm ({pending.length})</h2>
          {pending.length === 0 && !loading && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Không có gì pending. 🎉
            </Card>
          )}
          {pending.map((it) => (
            <ItemCard
              key={it.id}
              item={it}
              onToggle={() => toggleStatus(it)}
              onDelete={() => deleteItem(it.id)}
            />
          ))}
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Đã hoàn thành ({done.length})</h2>
          {done.length === 0 && !loading && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Chưa có item nào hoàn thành.
            </Card>
          )}
          {done.map((it) => (
            <ItemCard
              key={it.id}
              item={it}
              onToggle={() => toggleStatus(it)}
              onDelete={() => deleteItem(it.id)}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

function ItemCard({
  item,
  onToggle,
  onDelete,
}: {
  item: Item;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const overdue =
    item.status === 'PENDING' &&
    item.dueDate &&
    new Date(item.dueDate).getTime() < Date.now();

  return (
    <Card className="flex items-start gap-3 p-3">
      <button
        onClick={onToggle}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
          item.status === 'DONE'
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'hover:border-primary'
        }`}
        aria-label={item.status === 'DONE' ? 'Đánh dấu pending' : 'Đánh dấu xong'}
      >
        {item.status === 'DONE' && <Check className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            item.status === 'DONE' ? 'line-through text-muted-foreground' : ''
          }`}
        >
          {item.title}
        </p>
        {item.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
        )}
        {item.dueDate && (
          <p
            className={`mt-0.5 text-xs ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            Deadline: {new Date(item.dueDate).toLocaleDateString('vi-VN')}
            {overdue && ' (quá hạn)'}
          </p>
        )}
      </div>
      <button
        onClick={onDelete}
        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label="Xoá"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </Card>
  );
}
