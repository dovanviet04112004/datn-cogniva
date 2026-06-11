import Link from 'next/link';
import { BrainCircuit } from 'lucide-react';

import { getServerSession } from '@/lib/auth-server';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-md">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold">Cogniva</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
            <Link
              href="/#features"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Features
            </Link>
            <Link
              href="/pricing"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/about"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              About
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {session ? (
              <Button asChild>
                <Link href="/dashboard">Open app</Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link href="/sign-up">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        <div className="text-muted-foreground container flex flex-col items-center justify-between gap-2 py-6 text-sm md:flex-row">
          <p>© {new Date().getFullYear()} Cogniva. AI tutor that knows you.</p>
          <p>Built with Next.js, Drizzle, Mastra, Better Auth.</p>
        </div>
      </footer>
    </div>
  );
}
