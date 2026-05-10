/**
 * User menu — Client Component, hiển thị avatar + dropdown ở topbar.
 *
 * Trách nhiệm:
 *  - Hiện avatar (image hoặc fallback chữ cái đầu) — bấm mở menu
 *  - Hiện tên + email
 *  - Item "Profile & settings" → /settings (Phase 0 chưa có page, sẽ 404)
 *  - Item "Sign out" → gọi signOut() của Better Auth, redirect về "/"
 *
 * Nhận props từ AppTopbar (Server) thay vì gọi getSession ở client
 * → giảm 1 round trip; tránh flash "không có user" lúc hydrate.
 */
'use client';

import { useRouter } from 'next/navigation';
import { LogOut, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';

import { signOut } from '@/lib/auth-client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
};

/**
 * Sinh chữ viết tắt (tối đa 2 ký tự) cho avatar fallback.
 * Ưu tiên dùng name; nếu không có thì lấy phần trước @ của email.
 *
 * @example  initials("Ada Lovelace", "ada@x.io") => "AL"
 * @example  initials(null, "viet@example.com")    => "V"
 */
function initials(name: string | null, email: string) {
  const source = name?.trim() || email.split('@')[0] || 'User';
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'U';
}

export function UserMenu({ user }: Props) {
  const router = useRouter();

  /**
   * Đăng xuất — Better Auth tự xoá session cookie + record DB.
   * Sau khi xong, redirect về landing page và refresh để topbar nhận
   * trạng thái không còn session.
   */
  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast.error(error.message ?? 'Could not sign out.');
      return;
    }
    router.push('/');
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* asChild để Button render thành span của Trigger — tránh button-trong-button */}
        <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
          <Avatar className="h-9 w-9">
            {user.image && <AvatarImage src={user.image} alt={user.name ?? user.email} />}
            <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{user.name ?? 'Account'}</span>
            <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/settings')}>
          <UserIcon className="mr-2 h-4 w-4" />
          Profile & settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
