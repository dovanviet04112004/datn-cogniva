/**
 * AtomGuideView — V5 recipe "Atom guide" — LLM markdown study guide.
 *
 * Phase V5.2 (atom-centric). Spec: docs/plans/v5-notebooklm-layout.md §5.2.
 *
 * Flow:
 *   1. Fetch /api/workspaces/[id]/atom-guide (cache 24h in-memory)
 *   2. Render markdown qua react-markdown + remark-gfm
 *   3. Header: nút "Regenerate" (force refresh) + "Quay lại chat"
 */
'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

type GuideData = {
  markdown: string;
  generatedAt: string;
  atomCount: number;
  fromCache: boolean;
};

export function AtomGuideView({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = React.useState<GuideData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [regenerating, setRegenerating] = React.useState(false);

  const load = React.useCallback(
    async (regenerate = false) => {
      if (regenerate) setRegenerating(true);
      else setLoading(true);
      try {
        const url = `/api/workspaces/${workspaceId}/atom-guide${
          regenerate ? '?regenerate=1' : ''
        }`;
        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? `status ${res.status}`);
        }
        const json = (await res.json()) as GuideData;
        setData(json);
      } catch (err) {
        toast.error('Gen atom guide lỗi: ' + (err as Error).message);
      } finally {
        setLoading(false);
        setRegenerating(false);
      }
    },
    [workspaceId],
  );

  React.useEffect(() => {
    load();
  }, [load]);

  // V8.25: bỏ "Quay lại chat" — modal có X close riêng. Header chừa pr-14
  // cho X button modal ở góc trên phải.
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b bg-muted/20 px-4 py-2 pr-14">
        <div className="flex items-center justify-end gap-2">
          {data && (
            <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {data.fromCache ? (
                <span title={`Generated ${new Date(data.generatedAt).toLocaleString('vi-VN')}`}>
                  Cache 24h · {data.atomCount} atom
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-success">
                  <Sparkles className="h-3 w-3" />
                  Mới gen · {data.atomCount} atom
                </span>
              )}
            </div>
          )}
          <button
            onClick={() => load(true)}
            disabled={regenerating || loading}
            className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {regenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Regenerate
          </button>
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="h-3 w-3 text-primary" />
            Atom Guide
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <div className="mx-auto max-w-2xl">
            <div className="space-y-3">
              <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mt-6 h-6 w-1/4 animate-pulse rounded bg-muted" />
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              AI đang tổng kết atom của workspace… (~10-30s)
            </p>
          </div>
        ) : !data ? (
          <p className="text-center text-sm text-muted-foreground">
            Không load được. Bấm Regenerate để thử lại.
          </p>
        ) : (
          <article className="mx-auto max-w-2xl">
            {/* Tailwind prose alternative — custom classes vì project không
                bundle @tailwindcss/typography. Style markdown elements
                manually qua wrapper class. */}
            <div className="markdown-body space-y-3 text-sm leading-relaxed [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_td]:border [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-xs [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {data.markdown}
              </ReactMarkdown>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
