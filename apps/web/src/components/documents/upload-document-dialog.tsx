/**
 * UploadDocumentDialog — dialog modal upload PDF VÀO 1 WORKSPACE CỤ THỂ.
 *
 * Luồng mới (chuẩn): tài liệu phải vào ĐÚNG workspace user chọn — KHÔNG còn
 * auto fallback "Default" hay auto-route theo nội dung.
 *   - `workspaceId` prop (vd Sources panel trong 1 workspace) → upload thẳng,
 *     KHÔNG hiện picker.
 *   - Không truyền (global: dashboard / documents / onboarding) → hiện PICKER
 *     để user chọn workspace (React Query, key chung `qk.workspaces()`). Chưa có
 *     workspace nào → nhắc tạo (CreateWorkspaceDialog inline).
 *
 * UX: drag-drop / click pick · 1 PDF / lần · auto-close sau khi xong · chặn close
 * khi đang upload. Dropzone bị khoá tới khi đã chọn workspace.
 */
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

import { MAX_FILE_BYTES, useDocumentUpload } from './use-document-upload';

type Workspace = { id: string; name: string };

type Props = {
  /** Override trigger button. */
  trigger?: React.ReactNode;
  /** Optional controlled state (V5 workspace notebook gọi từ Sources panel). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional callback sau khi upload xong (V5 dùng để refresh router). */
  onUploaded?: () => void;
  /**
   * Workspace đích CỐ ĐỊNH → upload thẳng vào đó, KHÔNG hiện picker. Bỏ trống
   * (global) → hiện picker chọn workspace.
   */
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

  // Picker workspace — CHỈ khi không scoped. React Query (key chung qk.workspaces),
  // chỉ fetch khi dialog mở.
  const isScoped = workspaceId !== undefined;
  const { data: workspaces = [], isLoading: wsLoading } = useQuery({
    queryKey: qk.workspaces(),
    queryFn: () =>
      apiGet<{ workspaces: Workspace[] }>('/api/workspaces').then((d) => d.workspaces),
    enabled: open && !isScoped,
  });
  const [selectedWsId, setSelectedWsId] = React.useState<string | null>(null);
  // Auto-chọn workspace đầu khi list load (nếu user chưa chọn).
  React.useEffect(() => {
    if (!isScoped && workspaces.length > 0 && !selectedWsId) {
      setSelectedWsId(workspaces[0]!.id);
    }
  }, [workspaces, selectedWsId, isScoped]);

  const effectiveWsId = isScoped ? workspaceId : selectedWsId;
  const needsWorkspace = !effectiveWsId; // chưa chọn được workspace → khoá dropzone

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
      // Ngăn close khi đang upload — tránh user spam Esc làm gián đoạn UX
      onOpenChange={(next) => {
        if (isUploading && !next) return;
        setOpen(next);
      }}
    >
      {/* Controlled mode (V5): KHÔNG render trigger, parent tự mở qua state. */}
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

        {/* Picker workspace — chỉ ở chế độ global (không scoped). */}
        {!isScoped && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Upload vào workspace
            </label>
            {wsLoading ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Đang tải workspace…
              </p>
            ) : workspaces.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-center">
                <p className="mb-2 text-xs text-muted-foreground">
                  Bạn chưa có workspace nào — tạo 1 cái để chứa tài liệu.
                </p>
                {/* CreateWorkspaceDialog tự bust qk.workspaces → picker tự refetch. */}
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
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <FileUp className="h-8 w-8 text-muted-foreground" />
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
            <p className="text-xs text-muted-foreground">
              Tối đa 50 MB · application/pdf
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
