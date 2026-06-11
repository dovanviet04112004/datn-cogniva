import { AppSidebar } from '@/components/app/sidebar';
import { AppSidebarProvider } from '@/components/app/app-sidebar-context';
import { AppTopbar } from '@/components/app/topbar';
import { MaintenanceBanner } from '@/components/app/maintenance-banner';
import { ImpersonationBanner } from '@/components/app/impersonation-banner';
import { ChatDockProvider } from '@/components/dm/chat-dock';
import { FloatingDockProvider } from '@/components/app/floating-dock';
import { VoiceSessionProvider } from '@/components/groups/voice-session-provider';
import { AwayDetector } from '@/lib/group/use-away-detection';
import { getServerSession } from '@/lib/auth-server';
import { ConfirmProvider } from '@/lib/use-confirm';
import { CacheUserGuard } from '@/components/providers/cache-user-guard';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  return (
    <ConfirmProvider>
      <FloatingDockProvider>
        <ChatDockProvider currentUserId={session?.user.id ?? ''}>
          <VoiceSessionProvider>
            <AppSidebarProvider>
              {session?.user.id && <CacheUserGuard userId={session.user.id} />}
              <AwayDetector />
              <div className="bg-background flex h-screen overflow-hidden">
                <AppSidebar />
                <div className="flex flex-1 flex-col overflow-hidden">
                  <AppTopbar />
                  <ImpersonationBanner />
                  <MaintenanceBanner />
                  <main className="flex-1 overflow-y-auto">{children}</main>
                </div>
              </div>
            </AppSidebarProvider>
          </VoiceSessionProvider>
        </ChatDockProvider>
      </FloatingDockProvider>
    </ConfirmProvider>
  );
}
