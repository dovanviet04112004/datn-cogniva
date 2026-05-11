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
import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/app/user-menu';
import { CommandPaletteButton } from '@/components/app/command-palette';
import { PomodoroWidget } from '@/components/app/pomodoro-widget';

export async function AppTopbar() {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <header className="flex h-14 items-center gap-2 border-b bg-background/80 pl-14 pr-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:gap-4 md:pl-6 md:pr-6">
      {/* ── Search trigger (Cmd+K dialog) ──────────── */}
      <div className="flex flex-1 items-center">
        <CommandPaletteButton />
      </div>

      {/* ── Actions phải ─────────────────────────────── */}
      <div className="flex items-center gap-2">
        <PomodoroWidget />
        <ThemeToggle />
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
