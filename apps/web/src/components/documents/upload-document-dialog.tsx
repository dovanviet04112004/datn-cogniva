'use client';

import * as React from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { FileUp, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { CreateWorkspaceDialog } from '@/components/workspaces/create-workspace-dialog';
import { ComboSelect } from '@/components/ui/combo-select';
import { cn } from '@/lib/utils';

import { MAX_FILE_BYTES, useDocumentUpload } from '@/lib/use-document-upload';

type Workspace = { id: string; name: string };

type Props = {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onUploaded?: () => void;
  workspaceId?: string;
};

export function UploadDocumentDialog({
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onUploaded,
  workspaceId,
}: Props) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) controlledOnOpenChange?.(next);
    else setInternalOpen(next);
  };
  const { upload, isUploading } = useDocumentUpload();

  const isScoped = workspaceId !== undefined;
  const { data: workspaces = [], isLoading: wsLoading } = useQuery({
    queryKey: qk.workspaces(),
    queryFn: () => apiGet<{ workspaces: Workspace[] }>('/api/workspaces').then((d) => d.workspaces),
    enabled: open && !isScoped,
  });
  const [selectedWsId, setSelectedWsId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!isScoped && workspaces.length > 0 && !selectedWsId) {
      setSelectedWsId(workspaces[0]!.id);
    }
  }, [workspaces, selectedWsId, isScoped]);

  const effectiveWsId = isScoped ? workspaceId : selectedWsId;
  const needsWorkspace = !effectiveWsId;

  const onDrop = React.useCallback(
    async (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        const reason = rejected[0]?.errors[0]?.message ?? 'Invalid file';
        toast.error(reason);
        return;
      }
      const file = accepted[0];
      if (!file) return;
      if (!effectiveWsId) {
        toast.error('Hãy chọn workspace để upload vào');
        return;
      }
      await upload(file, effectiveWsId);
      setOpen(false);
      onUploaded?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upload, onUploaded, effectiveWsId],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: MAX_FILE_BYTES,
    multiple: false,
    disabled: isUploading || needsWorkspace,
    onDrop,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isUploading && !next) return;
        setOpen(next);
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus className="mr-1 h-4 w-4" />
              Upload
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload tài liệu</DialogTitle>
          <DialogDescription>
            PDF tối đa 50MB. Cogniva parse → chunk → embed vào workspace bạn chọn.
          </DialogDescription>
        </DialogHeader>

        {!isScoped && (
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-medium">
              Upload vào workspace
            </label>
            {wsLoading ? (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /> Đang tải workspace…
              </p>
            ) : workspaces.length === 0 ? (
              <div className="border-border bg-muted/30 rounded-lg border border-dashed p-3 text-center">
                <p className="text-muted-foreground mb-2 text-xs">
                  Bạn chưa có workspace nào — tạo 1 cái để chứa tài liệu.
                </p>
                <CreateWorkspaceDialog />
              </div>
            ) : (
              <ComboSelect
                value={selectedWsId ?? ''}
                onChange={(v) => setSelectedWsId(v)}
                options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
                placeholder="Chọn workspace"
                disabled={isUploading}
              />
            )}
          </div>
        )}

        <div
          {...getRootProps()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
            isDragActive && !isDragReject && 'border-primary bg-primary/5',
            isDragReject && 'border-destructive bg-destructive/5',
            (isUploading || needsWorkspace) && 'pointer-events-none opacity-60',
          )}
        >
          <input {...getInputProps()} />
          {isUploading ? (
            <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
          ) : (
            <FileUp className="text-muted-foreground h-8 w-8" />
          )}
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {isUploading
                ? 'Đang xử lý — parse + chunk + embed…'
                : needsWorkspace
                  ? 'Chọn workspace ở trên trước'
                  : isDragActive
                    ? 'Thả file vào đây'
                    : 'Kéo PDF vào hoặc bấm để chọn'}
            </p>
            <p className="text-muted-foreground text-xs">Tối đa 50 MB · application/pdf</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
