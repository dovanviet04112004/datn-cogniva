/**
 * Layout cho route group (app) — bao toàn bộ trang yêu cầu đăng nhập.
 *
 * Cấu trúc 2 cột cố định:
 *  - AppSidebar (trái, w-64, hidden trên mobile)  — điều hướng chính
 *  - AppTopbar  (trên, h-14)                      — search + user menu
 *  - main (phần còn lại, scroll y)                — render route con
 *
 * Lưu ý: middleware đã chặn user chưa login → ở đây không cần check session
 * lần nữa, nhưng từng page con vẫn nên gọi getServerSession() để lấy thông tin
 * user (firstName để greet, plan để gate feature, …) — đã dedup + Redis-backed (P1).
 */
import { AppSidebar } from '@/components/app/sidebar';
import { AppSidebarProvider } from '@/components/app/app-sidebar-context';
import { AppTopbar } from '@/components/app/topbar';
import { CoppaBanner } from '@/components/consent/coppa-banner';
import { MaintenanceBanner } from '@/components/app/maintenance-banner';
import { ImpersonationBanner } from '@/components/app/impersonation-banner';
import { ChatDockProvider } from '@/components/dm/chat-dock';
import { FloatingDockProvider } from '@/components/app/floating-dock';
import { VoiceSessionProvider } from '@/components/groups/voice-session-provider';
import { AwayDetector } from '@/lib/group/use-away-detection';
import { getServerSession } from '@/lib/auth-server';
import { ConfirmProvider } from '@/lib/use-confirm';
import { CacheUserGuard } from '@/components/providers/cache-user-guard';

// V6 (2026-05-20): Bỏ AI Tutor drawer (Cmd+J global) — Chat workspace giờ là
// trung tâm thay thế. Conversations persistent + scope theo Sources checkbox.

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // currentUserId cho ChatDock (cửa sổ chat nổi cần biết user hiện tại).
  // getServerSession: deduped trong request (share với AppTopbar) + Redis-backed (P1).
  const session = await getServerSession();

  // AppSidebarProvider chia sẻ drawer state giữa AppSidebar (drawer) và
  // MobileMenuTrigger (hamburger button trong AppTopbar).
  return (
    <ConfirmProvider>
      <FloatingDockProvider>
      <ChatDockProvider currentUserId={session?.user.id ?? ''}>
      <VoiceSessionProvider>
      <AppSidebarProvider>
        {/* Chống rò rỉ cache React Query khi đổi tài khoản trên cùng browser. */}
        {session?.user.id && <CacheUserGuard userId={session.user.id} />}
        {/* V2 G3.6: auto-idle 15min no input + tab hidden → set status='idle' */}
        <AwayDetector />
        <div className="flex h-screen overflow-hidden bg-background">
          <AppSidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <AppTopbar />
            {/* Impersonation banner — admin đang impersonate user (Phase 6). Top priority. */}
            <ImpersonationBanner />
            {/* Maintenance banner — admin bật ở /admin/system/maintenance. Cache 5s. */}
            <MaintenanceBanner />
            {/* COPPA banner ngay dưới topbar — show khi user PENDING/REJECTED */}
            <CoppaBanner />
            {/* main có overflow-y-auto để chỉ phần nội dung scroll, sidebar/topbar đứng yên */}
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
