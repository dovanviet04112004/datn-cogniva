/**
 * AiGenerateDialog — AI sinh examQuestion từ document.
 *
 * User chọn document → API call generate-questions endpoint → questions thêm
 * vào exam. Tái dùng pattern từ /quiz AI gen, chỉ khác URL endpoint.
 */
'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ComboSelect } from '@/components/ui/combo-select';

interface DocRow {
  id: string;
  filename: string;
  status: string;
  chunks?: number;
}

interface Props {
  examId: string;
  onDone: () => void;
}

export function AiGenerateDialog({ examId, onDone }: Props) {
  const [open, setOpen] = React.useState(false);
  const [docId, setDocId] = React.useState('');
  const [count, setCount] = React.useState('10');
  const [types, setTypes] = React.useState<Set<'MCQ' | 'TRUE_FALSE' | 'SHORT'>>(
    new Set(['MCQ', 'TRUE_FALSE']),
  );
  const [busy, setBusy] = React.useState(false);

  // Documents list — key dùng chung qk.documents() (ai-gen / quiz-gen / fc-gen).
  // Chỉ fetch khi mở dialog; lọc READY client-side.
  const { data: docsData } = useQuery({
    queryKey: qk.documents(),
    queryFn: () =>
      apiGet<{ documents: DocRow[] }>('/api/documents').then((d) => d.documents),
    enabled: open,
  });
  const docs = React.useMemo(
    () => (docsData ?? []).filter((doc) => doc.status === 'READY'),
    [docsData],
  );
  React.useEffect(() => {
    if (docs.length > 0 && !docId) setDocId(docs[0]!.id);
  }, [docs, docId]);

  const toggleType = (t: 'MCQ' | 'TRUE_FALSE' | 'SHORT') => {
    setTypes((set) => {
      const next = new Set(set);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docId) {
      toast.error('Chọn document');
      return;
    }
    if (types.size === 0) {
      toast.error('Chọn ít nhất 1 loại câu hỏi');
      return;
    }
    setBusy(true);
    try {
      const out = await apiSend<{ count: number }>(
        `/api/exams/${examId}/generate-questions`,
        'POST',
        { documentId: docId, types: [...types], count: Number(count) },
      );
      toast.success(`Đã thêm ${out.count} câu hỏi`);
      setOpen(false);
      onDone();
    } catch (err) {
      toast.error('AI gen fail: ' + (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Sparkles className="mr-1 h-3.5 w-3.5" /> AI gen
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>AI sinh câu hỏi</DialogTitle>
          <DialogDescription>
            AI đọc tài liệu và sinh câu hỏi tự động. Câu hỏi sẽ được thêm vào cuối list.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doc">Tài liệu nguồn</Label>
            {docs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Chưa có document READY. Upload + chờ xử lý trước.
              </p>
            ) : (
              // Thay <select> native bằng ComboSelect (gõ-để-lọc tài liệu).
              <ComboSelect
                id="doc"
                value={docId}
                onChange={(v) => setDocId(v)}
                options={docs.map((d) => ({ value: d.id, label: d.filename }))}
                placeholder="Chọn tài liệu"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Loại câu hỏi</Label>
            <div className="flex gap-2">
              {(['MCQ', 'TRUE_FALSE', 'SHORT'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={`flex-1 rounded border px-3 py-2 text-xs ${
                    types.has(t) ? 'border-primary bg-primary/5' : 'border-input'
                  }`}
                >
                  {t === 'MCQ' && 'Trắc nghiệm'}
                  {t === 'TRUE_FALSE' && 'Đúng/Sai'}
                  {t === 'SHORT' && 'Ngắn'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="count">Số câu hỏi</Label>
            <Input
              id="count"
              type="number"
              min="1"
              max="30"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              AI sinh tuần tự nên ~3-5s/câu. 10 câu mất ~30s.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button type="submit" disabled={busy || docs.length === 0}>
              {busy ? 'Đang sinh...' : 'Sinh câu hỏi'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
