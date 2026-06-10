/**
 * BriefingView — V5 recipe "Briefing doc" 200-300 từ tóm tắt workspace.
 *
 * Phase V5.3 (atom-centric). Spec: docs/plans/v5-notebooklm-layout.md §5.4.
 *
 * Tương tự AtomGuideView nhưng focus document content (executive summary
 * onboarding) thay vì atom learning guide. Markdown render với react-markdown.
 */
'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, Map as MapIcon, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

type BriefingData = {
  markdown: string;
  generatedAt: string;
  docCount: number;
  fromCache: boolean;
};

export function BriefingView({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = React.useState<BriefingData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [regenerating, setRegenerating] = React.useState(false);

  const load = React.useCallback(
    async (regenerate = false) => {
      if (regenerate) setRegenerating(true);
      else setLoading(true);
      try {
        const url = `/api/workspaces/${workspaceId}/briefing${
          regenerate ? '?regenerate=1' : ''
        }`;
        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? `status ${res.status}`);
        }
        const json = (await res.json()) as BriefingData;
        setData(json);
      } catch (err) {
        toast.error('Gen briefing lỗi: ' + (err as Error).message);
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

  // V8.25: bỏ "Quay lại chat" — modal có X close. Chừa pr-14 cho X button.
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b bg-muted/20 px-4 py-2 pr-14">
        <div className="flex items-center justify-end gap-2">
          {data && (
            <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {data.fromCache ? (
                <span title={`Generated ${new Date(data.generatedAt).toLocaleString('vi-VN')}`}>
                  Cache 24h · {data.docCount} doc
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-success">
                  <Sparkles className="h-3 w-3" />
                  Mới gen · {data.docCount} doc
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
            <MapIcon className="h-3 w-3 text-primary" />
            Briefing Doc
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <div className="mx-auto max-w-xl space-y-3">
            <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="mt-6 h-5 w-1/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <p className="mt-6 text-center text-xs text-muted-foreground">
              AI đang đọc sources và tóm tắt… (~5-15s)
            </p>
          </div>
        ) : !data ? (
          <p className="text-center text-sm text-muted-foreground">
            Không load được. Bấm Regenerate để thử lại.
          </p>
        ) : (
          <article className="mx-auto max-w-xl">
            <div className="markdown-body space-y-2 text-sm leading-relaxed [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs">
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
