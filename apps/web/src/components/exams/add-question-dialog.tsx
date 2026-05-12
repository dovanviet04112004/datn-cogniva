/**
 * AddQuestionDialog — modal thêm câu hỏi manual cho exam.
 *
 * Phase 16 hỗ trợ 4 type qua dialog: MCQ_SINGLE, MCQ_MULTI, TRUE_FALSE, SHORT.
 * Type khác (ORDERING, MATCHING, ESSAY) wire sau khi UI quá phức tạp 1 modal.
 */
'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type QType = 'MCQ_SINGLE' | 'MCQ_MULTI' | 'TRUE_FALSE' | 'SHORT';

interface Props {
  examId: string;
  onDone: () => void;
}

export function AddQuestionDialog({ examId, onDone }: Props) {
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState<QType>('MCQ_SINGLE');
  const [prompt, setPrompt] = React.useState('');
  const [options, setOptions] = React.useState<string[]>(['', '', '', '']);
  const [correctSingle, setCorrectSingle] = React.useState<number>(0);
  const [correctMulti, setCorrectMulti] = React.useState<Set<number>>(new Set());
  const [correctTF, setCorrectTF] = React.useState<boolean>(true);
  const [correctShort, setCorrectShort] = React.useState('');
  const [acceptableAnswers, setAcceptableAnswers] = React.useState('');
  const [points, setPoints] = React.useState('1');
  const [explanation, setExplanation] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const reset = () => {
    setType('MCQ_SINGLE');
    setPrompt('');
    setOptions(['', '', '', '']);
    setCorrectSingle(0);
    setCorrectMulti(new Set());
    setCorrectTF(true);
    setCorrectShort('');
    setAcceptableAnswers('');
    setPoints('1');
    setExplanation('');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error('Nhập đề bài');
      return;
    }
    let correctAnswer: unknown;
    let optsArr: string[] | null = null;
    let altsArr: string[] | undefined;

    if (type === 'MCQ_SINGLE' || type === 'MCQ_MULTI') {
      const filled = options.filter((o) => o.trim());
      if (filled.length < 2) {
        toast.error('MCQ cần ít nhất 2 đáp án');
        return;
      }
      optsArr = filled;
      if (type === 'MCQ_SINGLE') {
        if (correctSingle >= filled.length) {
          toast.error('Chọn đáp án đúng');
          return;
        }
        correctAnswer = correctSingle;
      } else {
        const picked = [...correctMulti].filter((i) => i < filled.length);
        if (picked.length === 0) {
          toast.error('Chọn ít nhất 1 đáp án đúng');
          return;
        }
        correctAnswer = picked;
      }
    } else if (type === 'TRUE_FALSE') {
      correctAnswer = correctTF;
    } else if (type === 'SHORT') {
      if (!correctShort.trim()) {
        toast.error('Nhập đáp án chuẩn');
        return;
      }
      correctAnswer = correctShort.trim();
      const alts = acceptableAnswers
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      if (alts.length > 0) altsArr = alts;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/exams/${examId}/questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          prompt: prompt.trim(),
          options: optsArr,
          correctAnswer,
          acceptableAnswers: altsArr,
          points: Number(points),
          explanation: explanation.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
      }
      toast.success('Đã thêm câu hỏi');
      reset();
      setOpen(false);
      onDone();
    } catch (err) {
      toast.error('Thêm fail: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const updateOption = (i: number, val: string) => {
    setOptions((opts) => opts.map((o, j) => (j === i ? val : o)));
  };

  const addOption = () => setOptions((opts) => [...opts, '']);
  const removeOption = (i: number) =>
    setOptions((opts) => opts.filter((_, j) => j !== i));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-3.5 w-3.5" /> Thêm câu hỏi
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Thêm câu hỏi</DialogTitle>
          <DialogDescription>
            MCQ, đúng/sai, hoặc trả lời ngắn. Để wire AI gen, đóng dialog này và bấm AI gen.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label>Loại câu hỏi</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'SHORT'] as QType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded border px-3 py-2 text-xs ${
                    type === t ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent'
                  }`}
                >
                  {t === 'MCQ_SINGLE' && 'MCQ 1 đáp án'}
                  {t === 'MCQ_MULTI' && 'MCQ nhiều đáp án'}
                  {t === 'TRUE_FALSE' && 'Đúng/Sai'}
                  {t === 'SHORT' && 'Ngắn'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt">Đề bài *</Label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              required
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {(type === 'MCQ_SINGLE' || type === 'MCQ_MULTI') && (
            <div className="space-y-2">
              <Label>Đáp án</Label>
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type={type === 'MCQ_SINGLE' ? 'radio' : 'checkbox'}
                    name="correct"
                    checked={
                      type === 'MCQ_SINGLE'
                        ? correctSingle === i
                        : correctMulti.has(i)
                    }
                    onChange={() => {
                      if (type === 'MCQ_SINGLE') setCorrectSingle(i);
                      else
                        setCorrectMulti((set) => {
                          const next = new Set(set);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        });
                    }}
                  />
                  <Input
                    value={opt}
                    onChange={(e) => updateOption(i, e.target.value)}
                    placeholder={`Đáp án ${String.fromCharCode(65 + i)}`}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {options.length < 8 && (
                <Button type="button" variant="ghost" size="sm" onClick={addOption}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Thêm đáp án
                </Button>
              )}
            </div>
          )}

          {type === 'TRUE_FALSE' && (
            <div className="space-y-2">
              <Label>Đáp án đúng</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCorrectTF(true)}
                  className={`flex-1 rounded border p-2 text-sm ${
                    correctTF ? 'border-primary bg-primary/5' : 'border-input'
                  }`}
                >
                  Đúng
                </button>
                <button
                  type="button"
                  onClick={() => setCorrectTF(false)}
                  className={`flex-1 rounded border p-2 text-sm ${
                    !correctTF ? 'border-primary bg-primary/5' : 'border-input'
                  }`}
                >
                  Sai
                </button>
              </div>
            </div>
          )}

          {type === 'SHORT' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="correct-short">Đáp án chuẩn *</Label>
                <Input
                  id="correct-short"
                  value={correctShort}
                  onChange={(e) => setCorrectShort(e.target.value)}
                  placeholder="Vd: cos(x)"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="alts">Đáp án thay thế (cách nhau bằng `|`)</Label>
                <Input
                  id="alts"
                  value={acceptableAnswers}
                  onChange={(e) => setAcceptableAnswers(e.target.value)}
                  placeholder="cos x | cosine(x)"
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="points">Điểm</Label>
              <Input
                id="points"
                type="number"
                min="0.5"
                step="0.5"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="explanation">Giải thích (tuỳ chọn)</Label>
            <textarea
              id="explanation"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Đang lưu...' : 'Thêm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
