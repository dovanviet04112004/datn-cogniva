import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';

import { ThemeProvider } from '@/components/providers/theme-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AppErrorBoundary } from '@/components/error-boundary';
import { PosthogProvider } from '@/components/posthog-provider';
import { CookieBanner } from '@/components/consent/cookie-banner';
import { LocaleProvider } from '@/lib/i18n/context';
import { LOCALE_COOKIE, parseLocale } from '@/lib/i18n/dict';

import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: '#020817' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <LocaleProvider initialLocale={locale}>
            <QueryProvider>
              <AppErrorBoundary>
                <PosthogProvider>
                  <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
                </PosthogProvider>
              </AppErrorBoundary>
            </QueryProvider>
            <Toaster richColors closeButton />
            <CookieBanner />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
