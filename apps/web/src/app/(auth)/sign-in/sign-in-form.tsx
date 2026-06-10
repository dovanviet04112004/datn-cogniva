/**
 * Form sign-in — Client Component (dùng react-hook-form + zod + Better Auth).
 *
 * Luồng:
 *  1. User nhập email + password → react-hook-form validate qua zod schema.
 *  2. submit → gọi `signIn.email()` của Better Auth client; nó POST tới
 *     /api/auth/sign-in/email, set cookie phiên rồi trả về.
 *  3. Lỗi → hiển thị toast (sonner). Thành công → router.push(redirectTo)
 *     + router.refresh() để Server Component nhận được session mới.
 */
'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { signIn } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

// Zod schema — dùng cho cả validate UI lẫn type cho form values
const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

type FormValues = z.infer<typeof schema>;

/**
 * @param redirectTo Path để chuyển tới sau khi đăng nhập thành công
 */
export function SignInForm({ redirectTo }: { redirectTo: string }) {
  // isPending điều khiển spinner + disabled — tránh user click lặp
  const [isPending, setIsPending] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setIsPending(true);
    const { error } = await signIn.email({
      email: values.email,
      password: values.password,
    });

    if (error) {
      setIsPending(false);
      toast.error(error.message ?? 'Could not sign in. Check your credentials.');
      return;
    }

    // Đọc lại redirect param trực tiếp từ URL hiện tại — phòng case prop
    // `redirectTo` không nhận đúng giá trị (browser cache, RSC stale).
    const url = new URL(window.location.href);
    const freshRedirect = url.searchParams.get('redirect') ?? redirectTo;

    // Safety: phải là path tương đối, KHÔNG cho redirect absolute URL khác
    // domain (open redirect protection).
    const safeRedirect = freshRedirect.startsWith('/') && !freshRedirect.startsWith('//')
      ? freshRedirect
      : '/dashboard';

    // window.location.replace = full reload + KHÔNG add /sign-in vào history
    // (back button không quay lại form đã submit). Cookie session từ Better
    // Auth Set-Cookie response đã được browser process trước navigation.
    window.location.replace(safeRedirect);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </Button>
      </form>
    </Form>
  );
}
