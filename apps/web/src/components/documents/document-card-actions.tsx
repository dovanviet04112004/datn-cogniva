/**
 * DocumentCardActions — dropdown menu cho 1 document card.
 *
 * Actions:
 *   - Di chuyển sang workspace khác (gọi POST /api/documents/[id]/move)
 *   - (V4 có thể thêm: rename, delete, share)
 *
 * Render kebab menu (3 chấm) bên phải card. Click không trigger card link
 * vì menu nằm ngoài Link wrapper (xem documents/page.tsx layout).
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, FolderInput, Loader2, MoreVertical } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  documentId: string;
  currentWorkspaceId: string;
  workspaces: Array<{ id: string; name: string }>;
};

export function DocumentCardActions({ documentId, currentWorkspaceId, workspaces }: Props) {
  const router = useRouter();
  const [moving, setMoving] = React.useState(false);

  // Chỉ 1 workspace (Default) → không có ý nghĩa hiển thị move
  if (workspaces.length <= 1) return null;

  const move = async (workspaceId: string, workspaceName: string) => {
    if (workspaceId === currentWorkspaceId) return;
    setMoving(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `status ${res.status}`);
      }
      toast.success(`Đã chuyển sang "${workspaceName}"`);
      router.refresh();
    } catch (err) {
      toast.error('Di chuyển thất bại: ' + (err as Error).message);
    } finally {
      setMoving(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0"
          aria-label="Tuỳ chọn document"
          disabled={moving}
        >
          {moving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreVertical className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
          <FolderInput className="h-3.5 w-3.5" />
          Di chuyển sang
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((ws) => {
          const isCurrent = ws.id === currentWorkspaceId;
          return (
            <DropdownMenuItem
              key={ws.id}
              disabled={isCurrent}
              onSelect={(e) => {
                e.preventDefault();
                if (!isCurrent) move(ws.id, ws.name);
              }}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{ws.name}</span>
              {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
