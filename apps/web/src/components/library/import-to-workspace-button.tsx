/**
 * ImportToWorkspaceButton — V1 Library.
 *
 * CTA chính: chọn workspace + import doc vào → 1-click clone.
 * Sau import: toast + redirect tới workspace/[id] hoặc /workspaces.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

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
import { useT } from '@/lib/i18n/context';

type Workspace = {
  id: string;
  name: string;
};

export function ImportToWorkspaceButton({
  docId,
  disabled,
}: {
  docId: string;
  disabled?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [selectedWsId, setSelectedWsId] = React.useState<string | null>(null);

  // Workspaces list (chỉ fetch khi mở dialog) — key dùng chung qk.workspaces().
  const { data: workspaces = [], isLoading: loading } = useQuery({
    queryKey: qk.workspaces(),
    queryFn: () =>
      apiGet<{ workspaces: Workspace[] }>('/api/workspaces').then(
        (d) => d.workspaces,
      ),
    enabled: open,
  });

  // Auto-chọn workspace đầu khi list load.
  React.useEffect(() => {
    if (workspaces.length > 0 && !selectedWsId) setSelectedWsId(workspaces[0]!.id);
  }, [workspaces, selectedWsId]);

  const doImport = async () => {
    if (!selectedWsId) {
      toast.error(t('library.import.choose_ws'));
      return;
    }
    setImporting(true);
    try {
      const data = await apiSend<{
        documentId: string;
        title: string;
        message: string;
      }>(`/api/library/docs/${docId}/import`, 'POST', {
        workspaceId: selectedWsId,
      });
      toast.success(data.message);
      setOpen(false);
      router.push(`/workspaces/${selectedWsId}/documents/${data.documentId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* Render qua <Button> để tự nhận shadow-primary + focus-ring chuẩn. */}
        <Button type="button" disabled={disabled}>
          <Plus className="h-4 w-4" />
          {t('library.import.add_to_ws')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('library.import.dialog_title')}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            {t('library.import.loading_ws')}
          </p>
        ) : workspaces.length === 0 ? (
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-muted-foreground">
              {t('library.import.no_ws')}
            </p>
            {/* CTA "Tạo workspace" → <Button asChild> giữ layout w-full. */}
            <Button asChild className="w-full">
              <Link href="/workspaces">{t('library.import.create_ws')}</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2 py-1">
            {/* B2.12: cap height + scroll khi user có nhiều workspace. */}
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {workspaces.map((ws) => (
                <li key={ws.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedWsId(ws.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition-colors ${
                      selectedWsId === ws.id
                        ? 'border-primary/40 bg-primary/5 font-semibold text-primary'
                        : 'border-divider hover:bg-muted'
                    }`}
                  >
                    <span className="truncate">{ws.name}</span>
                    {selectedWsId === ws.id && <span className="shrink-0">✓</span>}
                  </button>
                </li>
              ))}
            </ul>
            {/* Submit "Thêm vào" → <Button> giữ onClick/disabled + layout mt-3 w-full. */}
            <Button
              type="button"
              onClick={doImport}
              disabled={!selectedWsId || importing}
              className="mt-3 w-full"
            >
              {importing && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
              {t('library.import.add_button')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
