'use client';

import * as React from 'react';
import { Languages, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiSend } from '@cogniva/shared/api';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

type Target = 'vi' | 'en';

const TARGET_LABEL_KEY: Record<Target, string> = {
  vi: 'library.detail.lang_vi',
  en: 'library.detail.lang_en',
};

export function TranslateButton({
  docId,
  text,
  sourceLang,
  target,
  className,
}: {
  docId: string;
  text: string;
  sourceLang: string;
  target?: Target;
  className?: string;
}) {
  const t = useT();
  const resolvedTarget: Target = target ?? (sourceLang === 'vi' ? 'en' : 'vi');
  const [translated, setTranslated] = React.useState<string | null>(null);
  const [showing, setShowing] = React.useState<'original' | 'translated'>('original');
  const [loading, setLoading] = React.useState(false);

  if (sourceLang === resolvedTarget) return null;

  const toggle = async () => {
    if (showing === 'translated') {
      setShowing('original');
      return;
    }
    if (translated) {
      setShowing('translated');
      return;
    }
    setLoading(true);
    try {
      const data = await apiSend<{ translated: string }>(
        `/api/library/docs/${docId}/translate`,
        'POST',
        { target: resolvedTarget, text },
      );
      setTranslated(data.translated);
      setShowing('translated');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      className={cn(
        'border-divider text-muted-foreground hover:border-discovery-500/40 hover:bg-discovery-500/5 hover:text-discovery-700 dark:hover:text-discovery-300 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50',
        className,
      )}
      title={t('library.translate.translate_title')
        .replace('{from}', sourceLang.toUpperCase())
        .replace('{to}', resolvedTarget.toUpperCase())}
    >
      {loading ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : (
        <Languages className="h-2.5 w-2.5" />
      )}
      {showing === 'translated'
        ? t('library.translate.original')
        : t(TARGET_LABEL_KEY[resolvedTarget])}
    </button>
  );
}

function TranslatableTextImpl({
  docId,
  text,
  sourceLang,
  target,
  className,
  buttonAlign = 'right',
}: {
  docId: string;
  text: string;
  sourceLang: string;
  target?: Target;
  className?: string;
  buttonAlign?: 'left' | 'right';
}) {
  const t = useT();
  const resolvedTarget: Target = target ?? (sourceLang === 'vi' ? 'en' : 'vi');
  const [translated, setTranslated] = React.useState<string | null>(null);
  const [showing, setShowing] = React.useState<'original' | 'translated'>('original');
  const [loading, setLoading] = React.useState(false);

  const canTranslate = sourceLang !== resolvedTarget;

  const toggle = async () => {
    if (!canTranslate) return;
    if (showing === 'translated') {
      setShowing('original');
      return;
    }
    if (translated) {
      setShowing('translated');
      return;
    }
    setLoading(true);
    try {
      const data = await apiSend<{ translated: string }>(
        `/api/library/docs/${docId}/translate`,
        'POST',
        { target: resolvedTarget, text },
      );
      setTranslated(data.translated);
      setShowing('translated');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const displayed = showing === 'translated' && translated ? translated : text;

  return (
    <div className={className}>
      <p className="text-foreground/85 text-[12.5px] leading-relaxed">{displayed}</p>
      {canTranslate && (
        <div className={cn('mt-1.5 flex', buttonAlign === 'right' && 'justify-end')}>
          <button
            type="button"
            onClick={toggle}
            disabled={loading}
            className="border-divider text-muted-foreground hover:border-discovery-500/40 hover:bg-discovery-500/5 hover:text-discovery-700 dark:hover:text-discovery-300 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Languages className="h-2.5 w-2.5" />
            )}
            {showing === 'translated'
              ? t('library.translate.original')
              : `→ ${t(TARGET_LABEL_KEY[resolvedTarget])}`}
          </button>
        </div>
      )}
    </div>
  );
}

export const TranslatableText = React.memo(TranslatableTextImpl);
