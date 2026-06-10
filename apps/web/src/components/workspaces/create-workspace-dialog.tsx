/**
 * CreateWorkspaceDialog — dialog modal để tạo workspace mới.
 *
 * Thay thế pattern cũ `showForm` toggle inline expand trên /workspaces. Dialog
 * cho UX rõ ràng hơn:
 *   - Click button → modal mở
 *   - Esc / click overlay → close
 *   - Submit thành công → close + callback `onCreated()` để parent refresh list
 *
 * Form fields:
 *   - name (required)
 *   - description (optional)
 */
'use client';

import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

import { apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
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

type Props = {
  /** Callback sau khi tạo thành công — parent gọi refresh list. */
  onCreated?: () => void;
  /** Override trigger button. Default: "+ Workspace mới". */
  trigger?: React.ReactNode;
  /** Controlled mode — parent quản lý open state. Nếu provide thì
   *  KHÔNG cần `trigger` (parent tự trigger ngoài dialog). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CreateWorkspaceDialog({
  onCreated,
  trigger,
  open: openProp,
  onOpenChange,
}: Props) {
  const [openLocal, setOpenLocal] = React.useState(false);
  // Controlled nếu parent pass openProp, uncontrolled nếu không
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openLocal;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setOpenLocal(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const queryClient = useQueryClient();

  const reset = () => {
    setName('');
    setDescription('');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Cần tên workspace');
      return;
    }
    setSubmitting(true);
    try {
      await apiSend('/api/workspaces', 'POST', {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast.success('Đã tạo workspace');
      // Bust React Query cache list workspace (qk.workspaces) — picker upload,
      // list, mọi nơi dùng useQuery sẽ thấy workspace mới NGAY (choke-point chung).
      queryClient.invalidateQueries({ queryKey: qk.workspaces() });
      reset();
      setOpen(false);
      onCreated?.();
    } catch (err) {
      toast.error('Tạo thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Render trigger CHỈ khi uncontrolled — controlled mode parent
          tự gọi setOpen(true) từ ngoài. */}
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus className="mr-1 h-4 w-4" />
              Workspace mới
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Tạo workspace mới</DialogTitle>
            <DialogDescription>
              Gom tài liệu theo môn / dự án. AI Tutor chỉ trả lời trong phạm vi workspace này.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">
                Tên workspace <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Vd: Hệ phân tán, Toán cao cấp..."
                autoFocus
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-desc">Mô tả (tuỳ chọn)</Label>
              <textarea
                id="ws-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder='Vd: "Tài liệu môn hệ phân tán, MapReduce, Paxos..."'
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">
                Mô tả giúp bạn nhận ra workspace nhanh hơn (tuỳ chọn).
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Huỷ
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Đang tạo...
                </>
              ) : (
                'Tạo'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
