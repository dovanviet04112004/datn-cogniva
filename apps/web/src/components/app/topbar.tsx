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
import { Search } from 'lucide-react';

import { auth } from '@/lib/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/app/user-menu';

export async function AppTopbar() {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-background/80 pl-14 pr-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:pl-6 md:pr-6">
      {/* ── Search ────────────────────────────────────── */}
      <div className="relative flex flex-1 items-center">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          placeholder="Search documents, concepts, flashcards..."
          className="h-9 w-full max-w-md rounded-md border border-input bg-background pl-9 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {/* Phím tắt ⌘K hiện trên màn hình lớn — wire bằng cmdk ở Phase 7 */}
        <kbd className="pointer-events-none absolute right-3 hidden select-none items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:flex">
          ⌘K
        </kbd>
      </div>

      {/* ── Actions phải ─────────────────────────────── */}
      <div className="flex items-center gap-2">
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
