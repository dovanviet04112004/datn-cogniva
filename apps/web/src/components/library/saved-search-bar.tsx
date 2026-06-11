'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bookmark, Loader2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useConfirm } from '@/lib/use-confirm';
import { useT } from '@/lib/i18n/context';

type SavedSearch = {
  id: string;
  name: string;
  queryParams: Record<string, string | number | string[]>;
  notifyOnNew: boolean;
  createdAt: string;
};

const TRACKABLE_PARAMS = [
  'q',
  'subject',
  'level',
  'grade',
  'docType',
  'language',
  'fileFormat',
  'difficulty',
  'sort',
];

export function SavedSearchBar() {
  const t = useT();
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [notify, setNotify] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const activeParams = React.useMemo(() => {
    const obj: Record<string, string> = {};
    for (const key of TRACKABLE_PARAMS) {
      const v = searchParams.get(key);
      if (v) obj[key] = v;
    }
    return obj;
  }, [searchParams]);
  const hasActive = Object.keys(activeParams).length > 0;

  const {
    data: saved = [],
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: qk.librarySavedSearches(),
    queryFn: () =>
      apiGet<{ savedSearches: SavedSearch[] }>('/api/library/saved-searches')
        .then((d) => d.savedSearches)
        .catch(() => [] as SavedSearch[]),
  });

  const save = async () => {
    if (name.trim().length < 2) {
      toast.error(t('library.saved.err_name'));
      return;
    }
    setSubmitting(true);
    try {
      await apiSend('/api/library/saved-searches', 'POST', {
        name: name.trim(),
        queryParams: activeParams,
        notifyOnNew: notify,
      });
      toast.success(`${t('library.saved.saved_prefix')} "${name.trim()}"`);
      setName('');
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string, displayName: string) => {
    const ok = await confirm({
      title: t('library.saved.delete_confirm').replace('{name}', displayName),
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiSend(`/api/library/saved-searches/${id}`, 'DELETE');
      toast.success(t('library.saved.deleted'));
      qc.setQueryData<SavedSearch[]>(qk.librarySavedSearches(), (old) =>
        (old ?? []).filter((s) => s.id !== id),
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const buildHref = (params: Record<string, string | number | string[]>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) sp.set(k, v.join(','));
      else sp.set(k, String(v));
    }
    return `/library?${sp.toString()}`;
  };

  if (loading || (saved.length === 0 && !hasActive)) return null;

  return (
    <section className="mb-3 flex items-center gap-2">
      {saved.length > 0 && (
        <>
          <span className="text-muted-foreground shrink-0 text-[10.5px] font-semibold uppercase tracking-wider">
            <Bookmark className="mr-1 inline h-3 w-3" />
            {t('library.saved.label')}
          </span>
          <div className="scrollbar-hide flex flex-1 items-center gap-1.5 overflow-x-auto">
            {saved.map((s) => (
              <div key={s.id} className="group inline-flex shrink-0 items-center">
                <Link
                  href={buildHref(s.queryParams)}
                  className="border-divider bg-card hover:border-primary/40 hover:bg-primary/5 whitespace-nowrap rounded-l-md border border-r-0 px-2.5 py-1 text-[11.5px] font-medium"
                >
                  {s.name}
                </Link>
                <button
                  type="button"
                  onClick={() => remove(s.id, s.name)}
                  className="border-divider bg-card text-muted-foreground rounded-r-md border px-1.5 py-1 transition-colors hover:bg-rose-500/10 hover:text-rose-600"
                  aria-label={t('library.saved.delete_aria').replace('{name}', s.name)}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {hasActive && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-dashed px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
            >
              <Save className="h-2.5 w-2.5" />
              {t('library.saved.save_this')}
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('library.saved.dialog_title')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="border-divider bg-muted/30 rounded-lg border p-2">
                <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
                  {t('library.saved.current_filter')}
                </p>
                <ul className="space-y-0.5 text-[11.5px]">
                  {Object.entries(activeParams).map(([k, v]) => (
                    <li key={k}>
                      <span className="text-muted-foreground">{k}:</span> <strong>{v}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold">{t('library.saved.name_label')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder={t('library.saved.name_placeholder')}
                  className="border-divider bg-background w-full rounded-md border px-2 py-1.5 text-[12.5px]"
                />
              </div>
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                  className="accent-discovery-600 h-3.5 w-3.5"
                />
                {t('library.saved.notify')}
              </label>
              <Button onClick={save} disabled={submitting} className="w-full">
                {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {t('library.saved.save')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
