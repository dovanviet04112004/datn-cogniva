/**
 * GroupActionsMenu — nút ⚙ ở header channel-list, MỞ cho MỌI thành viên (không
 * chỉ admin như nút Settings cũ). Gồm:
 *   - Mời bạn bè  → dialog hiện invite CODE + LINK (copy được). Member cũng tạo
 *     được invite (API cho phép).
 *   - Cài đặt nhóm → chỉ OWNER/ADMIN (vào trang settings).
 *   - Rời nhóm    → mọi role TRỪ OWNER (owner phải transfer/xoá group trước).
 *
 * Host kick member: đã có sẵn ở menu từng member (MemberSidebar) + tab Thành viên
 * trong Cài đặt — không lặp ở đây.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Link2, Loader2, LogOut, Settings, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/use-confirm';

type Props = {
  groupId: string;
  groupName: string;
  myRole: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  currentUserId: string;
  /**
   * Mở Cài đặt dạng MODAL overlay (GroupShell sở hữu state) thay vì điều hướng
   * sang route /settings — tránh unmount channel + reload tin nhắn khi đóng.
   */
  onOpenSettings?: () => void;
};

export function GroupActionsMenu({
  groupId,
  groupName,
  myRole,
  currentUserId,
  onOpenSettings,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';
  const isOwner = myRole === 'OWNER';
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const leave = async () => {
    const ok = await confirm({
      title: `Rời nhóm ${groupName}?`,
      description: 'Bạn sẽ không còn truy cập channel của nhóm. Có thể vào lại nếu có invite hợp lệ.',
      confirmLabel: 'Rời nhóm',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/groups/${groupId}/members/${currentUserId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error ?? 'Rời nhóm thất bại');
      }
      toast.success('Đã rời nhóm');
      router.push('/groups');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Tuỳ chọn nhóm"
            title="Tuỳ chọn nhóm"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setInviteOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Mời bạn bè
          </DropdownMenuItem>
          {canManage && onOpenSettings && (
            <DropdownMenuItem onClick={onOpenSettings} className="gap-2">
              <Settings className="h-4 w-4" />
              Cài đặt nhóm
            </DropdownMenuItem>
          )}
          {!isOwner && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={leave}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Rời nhóm
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <InviteDialog groupId={groupId} open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}

/**
 * InviteDialog — mở ra LẤY invite hiện có (GET), chưa có thì tạo mới (POST), hiện
 * CODE + LINK `/groups?invite=CODE` để copy. Link mở ra tự điền code ở /groups.
 */
function InviteDialog({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [code, setCode] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<'code' | 'link' | null>(null);

  // Đọc invite còn hiệu lực gần nhất qua React Query (chỉ fetch khi mở & chưa có code).
  const { data: inviteList, error } = useQuery({
    queryKey: qk.groupInvites(groupId),
    queryFn: () =>
      apiGet<{ invites?: Array<{ code: string }> }>(
        `/api/groups/${groupId}/invites`,
      ),
    enabled: open && !code,
  });

  React.useEffect(() => {
    if (error) toast.error((error as Error).message);
  }, [error]);

  // Tách nhánh GHI: không có invite sẵn → tạo mới (POST). Chạy sau khi đọc xong.
  React.useEffect(() => {
    if (!open || code || !inviteList) return;
    const existing = inviteList.invites?.[0]?.code;
    if (existing) {
      setCode(existing);
      return;
    }
    let aborted = false;
    apiSend<{ invite?: { code: string } }>(
      `/api/groups/${groupId}/invites`,
      'POST',
      {},
    )
      .then((d) => {
        if (!aborted) setCode(d.invite?.code ?? null);
      })
      .catch((err) => {
        if (!aborted) toast.error((err as Error).message);
      });
    return () => {
      aborted = true;
    };
  }, [open, code, inviteList, groupId]);

  const link =
    code && typeof window !== 'undefined'
      ? `${window.location.origin}/groups?invite=${code}`
      : '';

  const copyValue = (value: string, which: 'code' | 'link') => {
    navigator.clipboard.writeText(value);
    setCopied(which);
    toast.success(which === 'code' ? 'Đã copy code' : 'Đã copy link');
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mời bạn vào nhóm</DialogTitle>
          <DialogDescription>
            Chia sẻ code hoặc link. Người nhận mở link sẽ được điền sẵn code, hoặc tự
            nhập code ở trang Nhóm → &quot;Vào bằng code&quot;.
          </DialogDescription>
        </DialogHeader>

        {!code ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tạo lời mời...
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Invite code</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={code}
                  className="font-mono uppercase tracking-wider"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copyValue(code, 'code')}
                  aria-label="Copy code"
                  title="Copy code"
                >
                  {copied === 'code' ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Link mời</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={link}
                  className="text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copyValue(link, 'link')}
                  aria-label="Copy link"
                  title="Copy link"
                >
                  {copied === 'link' ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Link2 className={cn('h-4 w-4')} />
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
