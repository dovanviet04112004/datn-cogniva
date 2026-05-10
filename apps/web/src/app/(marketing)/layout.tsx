/**
 * Layout cho route group (marketing) — landing, pricing, about…
 *
 * Khác (app) layout: không có sidebar, có top nav công khai + footer.
 * Render Server Component → có thể gọi `auth.api.getSession()` trực tiếp
 * để biết user đã đăng nhập chưa, đổi CTA giữa "Sign in / Sign up" và
 * "Open app".
 */
import Link from 'next/link';
import { headers } from 'next/headers';
import { BrainCircuit } from 'lucide-react';

import { auth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  // Lấy session ngay lúc SSR — không kéo DB nếu user chưa có cookie.
  // headers() là async trong Next.js 15 → phải await.
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          {/* Logo + tên thương hiệu, click về trang chủ */}
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold">Cogniva</span>
          </Link>

          {/* Nav chính — chỉ hiện trên md+ để gọn trên mobile */}
          <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
            <Link href="/#features" className="text-muted-foreground transition-colors hover:text-foreground">
              Features
            </Link>
            <Link href="/pricing" className="text-muted-foreground transition-colors hover:text-foreground">
              Pricing
            </Link>
            <Link href="/about" className="text-muted-foreground transition-colors hover:text-foreground">
              About
            </Link>
          </nav>

          {/* CTA bên phải — đổi nội dung theo trạng thái session */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {session ? (
              // Đã login → 1 nút duy nhất dẫn vào app
              <Button asChild>
                <Link href="/dashboard">Open app</Link>
              </Button>
            ) : (
              // Chưa login → cặp CTA quen thuộc cho landing
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
        <div className="container flex flex-col items-center justify-between gap-2 py-6 text-sm text-muted-foreground md:flex-row">
          <p>© {new Date().getFullYear()} Cogniva. AI tutor that knows you.</p>
          <p>Built with Next.js, Drizzle, Mastra, Better Auth.</p>
        </div>
      </footer>
    </div>
  );
}
