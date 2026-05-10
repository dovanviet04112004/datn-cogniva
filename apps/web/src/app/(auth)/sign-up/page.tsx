/**
 * Trang sign-up — wrap form đăng ký, hiển thị thông tin về free tier.
 * Khác sign-in: không cần redirectTo (đăng ký mới thì luôn vào /dashboard).
 */
import Link from 'next/link';
import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignUpForm } from './sign-up-form';

export const metadata: Metadata = {
  title: 'Create account',
  description: 'Create your Cogniva account.',
};

export default function SignUpPage() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Create your account</CardTitle>
        <CardDescription>
          Free tier — 10 documents, 50 AI messages/day, no credit card.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignUpForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
