/**
 * GenerateDialog — popover chọn document + type → POST /api/flashcards/generate.
 *
 * Flow:
 *   1. Open: fetch /api/documents để list cho user chọn
 *   2. User chọn document + type (BASIC/CLOZE) + count
 *   3. Submit → loading state → notify thành công + refresh list
 *
 * Dùng Popover (đã có Radix) thay vì Dialog cho gọn, không cần modal overlay.
 */
'use client';

import * as React from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';

type Doc = { id: string; filename: string };

type Props = {
  onGenerated: () => void;
};

export function GenerateDialog({ onGenerated }: Props) {
  const [open, setOpen] = React.useState(false);
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [docId, setDocId] = React.useState<string>('');
  const [type, setType] = React.useState<'BASIC' | 'CLOZE'>('BASIC');
  const [limit, setLimit] = React.useState(5);
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

  const submit = async () => {
    if (!docId) {
      toast.error('Chọn 1 tài liệu trước');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/flashcards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: docId, type, limit }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      toast.success(`Tạo ${data.created} thẻ ${type}`);
      setOpen(false);
      onGenerated();
    } catch (err) {
      toast.error('Tạo thẻ thất bại: ' + (err as Error).message);
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
      <PopoverContent className="w-80 space-y-3" align="end">
        <h4 className="text-sm font-semibold">Tạo thẻ từ tài liệu</h4>

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
          <Label htmlFor="type">Loại thẻ</Label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as 'BASIC' | 'CLOZE')}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="BASIC">BASIC — front/back</option>
            <option value="CLOZE">CLOZE — điền chỗ trống</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="limit">Số chunks quét (max 50)</Label>
          <input
            id="limit"
            type="number"
            min={1}
            max={50}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Mỗi chunk sinh 1-3 thẻ → tổng ~{limit * 2} thẻ.
          </p>
        </div>

        <Button onClick={submit} disabled={submitting || !docId} className="w-full">
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Tạo thẻ
        </Button>
      </PopoverContent>
    </Popover>
  );
}
