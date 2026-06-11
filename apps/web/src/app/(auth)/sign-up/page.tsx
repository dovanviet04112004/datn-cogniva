import Link from 'next/link';
import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignUpForm } from './sign-up-form';

export const metadata: Metadata = {
  title: 'Create account',
  description: 'Create your Cogniva account.',
};

type Props = {
  searchParams: Promise<{ redirect?: string }>;
};

export default async function SignUpPage({ searchParams }: Props) {
  const { redirect } = await searchParams;
  const signInHref = redirect ? `/sign-in?redirect=${encodeURIComponent(redirect)}` : '/sign-in';
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Create your account</CardTitle>
        <CardDescription>
          Free tier — 10 documents, 50 AI messages/day, no credit card.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignUpForm redirectTo={redirect ?? '/dashboard'} />
        <p className="text-muted-foreground mt-6 text-center text-sm">
          Already have an account?{' '}
          <Link
            href={signInHref}
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
