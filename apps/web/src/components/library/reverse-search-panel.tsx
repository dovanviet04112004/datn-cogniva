/**
 * ReverseSearchPanel — Pillar #4 UI V1.
 *
 * Input mode: paste text HOẶC upload image (PNG/JPG/PDF first page).
 * Output: AI analysis card + 3 cluster (theory/exercise/exam) doc grid.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Camera,
  ChevronRight,
  FileText,
  Loader2,
  Sparkles,
  Upload as UploadIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { apiSend } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/lib/i18n/context';

type DocHit = {
  chunkId: string;
  docId: string;
  docTitle: string;
  pageNum: number;
  excerptHtml: string;
  score: number;
};

type ReverseResult = {
  detectedQuestion: string;
  analysis: {
    subjectSlug: string;
    level: string;
    topic: string;
    atomKeywords: string[];
    difficulty: 'easy' | 'medium' | 'hard';
  };
  theory: DocHit[];
  exercise: DocHit[];
  exam: DocHit[];
};

const MAX_IMG_BYTES = 5 * 1024 * 1024;

export function ReverseSearchPanel() {
  const t = useT();
  const [mode, setMode] = React.useState<'text' | 'image'>('text');
  const [problemText, setProblemText] = React.useState('');
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<ReverseResult | null>(null);

  const handleImage = (f: File | null) => {
    if (!f) {
      setImageFile(null);
      setImagePreviewUrl(null);
      return;
    }
    if (f.size > MAX_IMG_BYTES) {
      toast.error(t('library.reverse.img_too_large'));
      return;
    }
    if (!f.type.startsWith('image/')) {
      toast.error(t('library.reverse.img_only'));
      return;
    }
    setImageFile(f);
    setImagePreviewUrl(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (mode === 'text' && problemText.trim().length < 10) {
      toast.error(t('library.reverse.text_too_short'));
      return;
    }
    if (mode === 'image' && !imageFile) {
      toast.error(t('library.reverse.pick_image'));
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      let body: Record<string, unknown> = {};
      if (mode === 'text') {
        body = { problemText: problemText.trim() };
      } else if (imageFile) {
        const buf = await imageFile.arrayBuffer();
        const base64 = btoa(
          Array.from(new Uint8Array(buf))
            .map((b) => String.fromCharCode(b))
            .join(''),
        );
        body = {
          problemImageBase64: base64,
          problemImageMimeType: imageFile.type,
        };
      }

      const data = await apiSend<ReverseResult>(
        '/api/library/search/reverse',
        'POST',
        body,
      );
      setResult(data);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Input mode tabs */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode('text')}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
            mode === 'text'
              ? 'border-discovery-500/40 bg-discovery-500/5 text-discovery-700 dark:text-discovery-300'
              : 'border-divider bg-card hover:bg-muted'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          {t('library.reverse.tab_text')}
        </button>
        <button
          type="button"
          onClick={() => setMode('image')}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
            mode === 'image'
              ? 'border-discovery-500/40 bg-discovery-500/5 text-discovery-700 dark:text-discovery-300'
              : 'border-divider bg-card hover:bg-muted'
          }`}
        >
          <Camera className="h-3.5 w-3.5" />
          {t('library.reverse.tab_image')}
        </button>
      </div>

      {/* Input */}
      {mode === 'text' ? (
        <Textarea
          value={problemText}
          onChange={(e) => setProblemText(e.target.value)}
          placeholder={`${t('library.reverse.text_placeholder')}

Vd: "Tìm giá trị nhỏ nhất của hàm số f(x) = x³ - 3x² + 2 trên đoạn [0, 3]"`}
          rows={6}
          maxLength={3000}
          className="resize-none"
        />
      ) : (
        <label
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 transition-colors ${
            imageFile
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-divider hover:border-sky-500/30 hover:bg-sky-500/5'
          }`}
        >
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleImage(e.target.files?.[0] ?? null)}
          />
          {imagePreviewUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt={t('library.reverse.img_alt')}
                className="max-h-64 rounded-lg"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  handleImage(null);
                }}
                className="text-[11px] text-rose-500 hover:underline"
              >
                <X className="mr-0.5 inline h-3 w-3" />
                {t('library.reverse.change_img')}
              </button>
            </>
          ) : (
            <>
              <Camera className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">{t('library.reverse.pick_img_hint')}</p>
              <p className="text-[11px] text-muted-foreground">{t('library.reverse.img_constraints')}</p>
            </>
          )}
        </label>
      )}

      <Button onClick={submit} disabled={loading}>
        {loading ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="mr-1 h-3.5 w-3.5" />
        )}
        {t('library.reverse.submit')}
      </Button>

      {/* Result */}
      {result && (
        <section className="space-y-4">
          {/* Analysis card */}
          <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-sky-600">
              {t('library.reverse.ai_analysis')}
            </p>
            <p className="text-[13px] font-semibold">
              {t('library.reverse.topic')} <span className="text-sky-700 dark:text-sky-300">{result.analysis.topic}</span>
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t('library.reverse.subject')} {result.analysis.subjectSlug} · {t('library.reverse.level')} {result.analysis.level} · {t('library.reverse.difficulty')}{' '}
              <span
                className={`font-semibold ${
                  result.analysis.difficulty === 'hard'
                    ? 'text-rose-600'
                    : result.analysis.difficulty === 'medium'
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                }`}
              >
                {result.analysis.difficulty === 'hard'
                  ? t('library.reverse.diff_hard')
                  : result.analysis.difficulty === 'medium'
                    ? t('library.reverse.diff_medium')
                    : t('library.reverse.diff_easy')}
              </span>
            </p>
            {result.analysis.atomKeywords.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {result.analysis.atomKeywords.map((k) => (
                  <span
                    key={k}
                    className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10.5px] font-medium text-sky-700 dark:text-sky-300"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">
                {t('library.reverse.extracted_question')}
              </summary>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-card p-2 text-[12px]">
                {result.detectedQuestion}
              </p>
            </details>
          </div>

          {/* 3 cluster results */}
          <div className="grid gap-4 md:grid-cols-3">
            <ClusterColumn
              title={t('library.reverse.cluster_theory')}
              docs={result.theory}
              emptyText={t('library.reverse.empty_theory')}
            />
            <ClusterColumn
              title={t('library.reverse.cluster_exercise')}
              docs={result.exercise}
              emptyText={t('library.reverse.empty_exercise')}
            />
            <ClusterColumn
              title={t('library.reverse.cluster_exam')}
              docs={result.exam}
              emptyText={t('library.reverse.empty_exam')}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function ClusterColumn({
  title,
  docs,
  emptyText,
}: {
  title: string;
  docs: DocHit[];
  emptyText: string;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}{' '}
        <span className="font-mono text-[10px] text-muted-foreground/60">({docs.length})</span>
      </p>
      {docs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-divider px-3 py-4 text-center text-[11px] italic text-muted-foreground/60">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((d) => (
            <li key={d.chunkId}>
              <Link
                href={`/library/${d.docId}`}
                className="group block rounded-lg border border-divider bg-card p-2.5 transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                <div className="flex items-start gap-1.5">
                  <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[12px] font-semibold leading-tight">
                      {d.docTitle}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {t('library.reverse.page').replace('{num}', String(d.pageNum))}
                    </p>
                  </div>
                </div>
                <p
                  className="mt-1.5 line-clamp-3 text-[11px] leading-snug text-muted-foreground [&_mark]:rounded [&_mark]:bg-amber-500/30 [&_mark]:px-0.5 [&_mark]:text-foreground"
                  dangerouslySetInnerHTML={{ __html: d.excerptHtml }}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
