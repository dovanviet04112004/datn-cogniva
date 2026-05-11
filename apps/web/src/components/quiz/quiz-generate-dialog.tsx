/**
 * QuizGenerateDialog — popover chọn document + types + count → POST
 * /api/quiz/generate. Tương tự GenerateDialog flashcard nhưng cho quiz.
 *
 * Flow:
 *   1. Open: fetch /api/documents để list cho user chọn
 *   2. User chọn document + types (multi-select) + count + title
 *   3. Submit → loading state → redirect sang /quiz/[id]/attempt
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';

type Doc = { id: string; filename: string };
type QType = 'MCQ' | 'TRUE_FALSE' | 'SHORT';

const ALL_TYPES: { value: QType; label: string }[] = [
  { value: 'MCQ', label: 'MCQ — 4 lựa chọn' },
  { value: 'TRUE_FALSE', label: 'Đúng/Sai' },
  { value: 'SHORT', label: 'Trả lời ngắn (AI chấm)' },
];

export function QuizGenerateDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [docId, setDocId] = React.useState('');
  const [types, setTypes] = React.useState<QType[]>(['MCQ', 'TRUE_FALSE', 'SHORT']);
  const [count, setCount] = React.useState(8);
  const [title, setTitle] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    fetch('/api/documents')
      .then((r) => r.json())
      .then((d: { documents: Doc[] }) => {
        setDocs(d.documents);
        if (d.documents[0] && !docId) setDocId(d.documents[0].id);
      });
  }, [open, docId]);

  const toggleType = (t: QType) => {
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  };

  const submit = async () => {
    if (!docId) {
      toast.error('Chọn 1 tài liệu trước');
      return;
    }
    if (types.length === 0) {
      toast.error('Chọn ít nhất 1 loại câu hỏi');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/quiz/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: docId,
          types,
          count,
          title: title.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as { quiz: { id: string }; questions: unknown[] };
      toast.success(`Tạo ${data.questions.length} câu hỏi — bắt đầu làm bài`);
      setOpen(false);
      router.push(`/quiz/${data.quiz.id}/attempt`);
    } catch (err) {
      toast.error('Tạo quiz thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="default">
          <Sparkles className="mr-2 h-4 w-4" />
          AI generate
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 space-y-3" align="end">
        <h4 className="text-sm font-semibold">Tạo quiz từ tài liệu</h4>

        <div className="space-y-1.5">
          <Label htmlFor="doc">Tài liệu</Label>
          <select
            id="doc"
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {docs.length === 0 && <option value="">-- Chưa có tài liệu --</option>}
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Loại câu hỏi (multi)</Label>
          <div className="flex flex-col gap-1.5 rounded-md border bg-background p-2 text-sm">
            {ALL_TYPES.map((t) => (
              <label key={t.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={types.includes(t.value)}
                  onChange={() => toggleType(t.value)}
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="count">Số câu hỏi (1-20)</Label>
          <input
            id="count"
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="title">Tiêu đề (optional)</Label>
          <input
            id="title"
            type="text"
            value={title}
            placeholder="Mặc định: timestamp"
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>

        <Button onClick={submit} disabled={submitting || !docId} className="w-full">
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Tạo quiz
        </Button>
      </PopoverContent>
    </Popover>
  );
}
