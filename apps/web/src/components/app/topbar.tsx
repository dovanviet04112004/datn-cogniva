/**
 * Topbar của route (app) — Server Component để có thể trực tiếp lấy session
 * mà không cần truyền props từ layout xuống.
 *
 * Gồm:
 *  - Search input (chiếm phần lớn) — UI placeholder, sẽ wire ⌘K + global
 *    search ở Phase 7.
 *  - ThemeToggle (đổi giao diện light/dark)
 *  - UserMenu (dropdown avatar + sign out)
 *
 * Vì là Server Component, UserMenu phải được tách ra Client Component và
 * nhận user info qua props (Server không thể truyền function/event handler
 * trực tiếp xuống Client).
 */
import { getServerSession } from '@/lib/auth-server';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/app/user-menu';
import { CommandPaletteButton } from '@/components/app/command-palette';
import { MobileMenuTrigger } from '@/components/app/mobile-menu-trigger';
import { PomodoroWidget } from '@/components/app/pomodoro-widget';
import { StreakBadge } from '@/components/app/streak-badge';
import { NotificationBell } from '@/components/app/notification-bell';

export async function AppTopbar() {
  // Deduped với AppLayout (cùng request → 1 lần resolve) + Redis-backed (P1).
  const session = await getServerSession();

  return (
    <header className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 md:gap-4 md:px-6">
      {/* Hamburger menu — chỉ hiện mobile, ngồi như flex child đầu tiên
          của topbar (KHÔNG fixed-position floating). */}
      <MobileMenuTrigger />

      {/* ── Search trigger (Cmd+K dialog) ──────────── */}
      <div className="flex flex-1 items-center">
        <CommandPaletteButton />
      </div>

      {/* ── Actions phải ─────────────────────────────── */}
      <div className="flex items-center gap-2">
        <StreakBadge />
        <PomodoroWidget />
        <ThemeToggle />
        {session?.user && <NotificationBell userId={session.user.id} />}
        {session?.user && (
          // Pick các trường cần — không leak token / id sensitive nào ra client
          <UserMenu
            user={{
              id: session.user.id,
              name: session.user.name ?? null,
              email: session.user.email,
              image: session.user.image ?? null,
            }}
          />
        )}
      </div>
    </header>
  );
}
