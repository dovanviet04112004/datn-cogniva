import { getServerSession } from '@/lib/auth-server';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/app/user-menu';
import { CommandPaletteButton } from '@/components/app/command-palette';
import { MobileMenuTrigger } from '@/components/app/mobile-menu-trigger';
import { PomodoroWidget } from '@/components/app/pomodoro-widget';
import { StreakBadge } from '@/components/app/streak-badge';
import { NotificationBell } from '@/components/app/notification-bell';

export async function AppTopbar() {
  const session = await getServerSession();

  return (
    <header className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 md:gap-4 md:px-6">
      <MobileMenuTrigger />

      <div className="flex flex-1 items-center">
        <CommandPaletteButton />
      </div>

      <div className="flex items-center gap-2">
        <StreakBadge />
        <PomodoroWidget />
        <ThemeToggle />
        {session?.user && <NotificationBell userId={session.user.id} />}
        {session?.user && (
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
