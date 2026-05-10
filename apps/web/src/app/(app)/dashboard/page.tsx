/**
 * Dashboard — trang chủ sau khi đăng nhập.
 *
 * Phase 0 chỉ có placeholder:
 *  - Greeting cá nhân hoá theo firstName từ session
 *  - 4 stat card (Documents/Cards/Quizzes/Conversations) tất cả "0" với
 *    helper text gợi user sang các phase tiếp theo
 *  - 3 quick action card disabled, gắn nhãn "Coming in Phase X" để lộ trình
 *
 * Server Component — gọi getSession trực tiếp; nếu null thì redirect
 * (mặc dù middleware đã chặn, đây là defensive layer cho trường hợp cookie
 * hết hạn ngay sau middleware nhưng trước khi page render).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowUpRight, BookOpen, BrainCircuit, ListChecks, MessageSquare } from 'lucide-react';

import { auth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const stats = [
  { label: 'Documents', value: '0', helper: 'Upload your first PDF', icon: BookOpen },
  { label: 'Cards due today', value: '0', helper: 'Review queue is empty', icon: BrainCircuit },
  { label: 'Quizzes taken', value: '0', helper: 'Try a starter quiz', icon: ListChecks },
  { label: 'AI conversations', value: '0', helper: 'Ask your first question', icon: MessageSquare },
];

const quickActions = [
  {
    title: 'Upload a document',
    description: 'PDF, DOCX, or paste a URL. We will chunk, embed, and graph it.',
    cta: 'Coming in Phase 1',
  },
  {
    title: 'Start a chat',
    description: 'Ask questions across all your sources. Cited answers, no hallucinations.',
    cta: 'Coming in Phase 2',
  },
  {
    title: 'Generate flashcards',
    description: 'Pick a chunk → AI extracts Q&A pairs scheduled with FSRS.',
    cta: 'Coming in Phase 5',
  },
];

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  // Defensive: middleware đã chặn — đây chỉ phòng race condition cookie hết hạn
  if (!session) {
    redirect('/sign-in?redirect=/dashboard');
  }

  // Lấy firstName để greet cá nhân — fallback message generic nếu không có
  const firstName = session.user.name?.split(' ')[0];
  const greeting = firstName ? `Welcome back, ${firstName}` : 'Welcome to Cogniva';

  return (
    <div className="container max-w-6xl py-8">
      {/* ── Greeting ────────────────────────────────────── */}
      <div className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        <p className="text-sm text-muted-foreground">
          You are on the foundation build. Upload, chat, and graph features land in Phase 1–4.
        </p>
      </div>

      {/* ── Stats grid ──────────────────────────────────── */}
      <section className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{stat.value}</div>
                <p className="mt-1 text-xs text-muted-foreground">{stat.helper}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* ── Quick actions (gắn nhãn phase) ─────────────── */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Quick actions</h2>
          <p className="text-xs text-muted-foreground">Tracked against the 16-week roadmap.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {quickActions.map((action) => (
            <Card key={action.title}>
              <CardHeader>
                <CardTitle className="text-base">{action.title}</CardTitle>
                <CardDescription>{action.description}</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Disabled tới khi feature thật ra mắt — tránh user click ảo */}
                <Button variant="outline" size="sm" disabled>
                  {action.cta}
                  <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
