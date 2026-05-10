/**
 * Trang sign-in — Server Component bọc form client để có thể đọc
 * searchParams (`redirect`) ở phía server.
 *
 * Cách dùng: middleware redirect tới đây với query `?redirect=/dashboard/...`
 * để sau khi đăng nhập user quay lại đúng trang đã muốn vào.
 */
import Link from 'next/link';
import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Cogniva account.',
};

type Props = {
  // Next.js 15: searchParams trả về Promise — phải await để đọc giá trị
  searchParams: Promise<{ redirect?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
  const { redirect } = await searchParams;
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in with your email and password.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Truyền redirect xuống form — nếu null fallback về /dashboard */}
        <SignInForm redirectTo={redirect ?? '/dashboard'} />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign up
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
