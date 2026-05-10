/**
 * Toaster — wrap component <Toaster /> của thư viện sonner với theme
 * đồng bộ với next-themes (light/dark) + class shadcn/ui.
 *
 * Cách dùng: import { toast } from 'sonner' rồi gọi `toast(...)` ở bất cứ
 * component nào — toast sẽ render trong <Toaster /> đặt ở root layout.
 *   toast.success("Đã lưu");
 *   toast.error(err.message);
 */
'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

export function Toaster({ ...props }: ToasterProps) {
  const { theme = 'system' } = useTheme();
  return (
    <Sonner
      // Truyền theme từ next-themes vào sonner để toast đổi nền theo dark/light
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      // Override class mặc định của sonner để dùng CSS variables shadcn
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}
