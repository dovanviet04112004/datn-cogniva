/**
 * Form sign-up — Client Component, validation đầy đủ trước khi gửi backend.
 *
 * Khác sign-in form ở 2 điểm:
 *  - Có thêm trường `name` + xác nhận mật khẩu.
 *  - Sau submit thành công, autoSignIn của Better Auth tự đăng nhập luôn,
 *    chỉ cần redirect về /dashboard.
 *
 * Quy tắc password: ≥ 8 ký tự (khớp `minPasswordLength` ở lib/auth.ts) và
 * ≤ 72 ký tự (giới hạn của bcrypt — Better Auth hash bằng bcrypt).
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { signUp } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const schema = z
  .object({
    name: z.string().min(1, 'Name is required.').max(80),
    email: z.string().email('Enter a valid email address.'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      // 72 byte là giới hạn của bcrypt — vượt quá sẽ bị truncate âm thầm
      .max(72, 'Password must be 72 characters or fewer.'),
    confirmPassword: z.string(),
  })
  // Cross-field validation: 2 trường password phải giống nhau
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export function SignUpForm() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setIsPending(true);
    const { error } = await signUp.email({
      email: values.email,
      password: values.password,
      name: values.name,
      callbackURL: '/dashboard',
    });
    setIsPending(false);

    if (error) {
      // Lỗi điển hình: email đã tồn tại, password yếu, server lỗi…
      toast.error(error.message ?? 'Could not create your account.');
      return;
    }
    toast.success('Account created. Welcome to Cogniva!');
    router.push('/dashboard');
    router.refresh();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input autoComplete="name" placeholder="Ada Lovelace" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>At least 8 characters.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account
        </Button>
      </form>
    </Form>
  );
}
