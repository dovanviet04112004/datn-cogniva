/**
 * Root layout — bọc toàn bộ app, render 1 lần và áp dụng cho mọi route.
 *
 * Trách nhiệm:
 *  - Set `<html lang>`, font (Geist sans + mono qua next/font)
 *  - Khởi tạo provider toàn cục:
 *      ThemeProvider     → đồng bộ dark/light mode (next-themes, class-based)
 *      TooltipProvider   → cần thiết cho tất cả Tooltip của Radix
 *      Toaster (Sonner)  → notification stack chia sẻ giữa các route
 *  - Khai báo metadata SEO mặc định + theme color
 *
 * suppressHydrationWarning được bật trên <html> vì next-themes chèn class
 * "light"/"dark" qua script trước khi React hydrate → mismatch là dự kiến.
 */
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { ThemeProvider } from '@/components/providers/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AppErrorBoundary } from '@/components/error-boundary';
import { PosthogProvider } from '@/components/posthog-provider';
import { CookieBanner } from '@/components/consent/cookie-banner';

import './globals.css';

// Tải Geist từ Google Fonts qua next/font — biến CSS để Tailwind dùng được
const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  // metadataBase quan trọng cho OG image + canonical URL khi deploy.
  // Fallback localhost giúp dev local không cảnh báo.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Cogniva — AI tutor that knows you',
    template: '%s · Cogniva',
  },
  description:
    'AI-native learning platform with personal knowledge graph, multi-stage RAG, and adaptive mastery tracking.',
  keywords: ['AI tutor', 'spaced repetition', 'knowledge graph', 'RAG', 'learning'],
  authors: [{ name: 'Cogniva' }],
  openGraph: {
    type: 'website',
    title: 'Cogniva',
    description: 'AI tutor that knows you.',
  },
};

export const viewport: Viewport = {
  // themeColor cho address bar trên mobile — đổi theo light/dark
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: '#020817' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AppErrorBoundary>
            <PosthogProvider>
              <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            </PosthogProvider>
          </AppErrorBoundary>
          {/* Toaster dùng chung cho mọi route — đặt ngoài để tránh re-mount khi navigate */}
          <Toaster richColors closeButton />
          {/* GDPR cookie consent — chỉ show 1 lần per user, persist qua localStorage */}
          <CookieBanner />
        </ThemeProvider>
      </body>
    </html>
  );
}
