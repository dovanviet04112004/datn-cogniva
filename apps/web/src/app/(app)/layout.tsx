/**
 * Layout cho route group (app) — bao toàn bộ trang yêu cầu đăng nhập.
 *
 * Cấu trúc 2 cột cố định:
 *  - AppSidebar (trái, w-64, hidden trên mobile)  — điều hướng chính
 *  - AppTopbar  (trên, h-14)                      — search + user menu
 *  - main (phần còn lại, scroll y)                — render route con
 *
 * Lưu ý: middleware đã chặn user chưa login → ở đây không cần check session
 * lần nữa, nhưng từng page con vẫn nên gọi getSession() để lấy thông tin
 * user (firstName để greet, plan để gate feature, …).
 */
import { AppSidebar } from '@/components/app/sidebar';
import { AppTopbar } from '@/components/app/topbar';
import { CoppaBanner } from '@/components/consent/coppa-banner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppTopbar />
        {/* COPPA banner ngay dưới topbar — show khi user PENDING/REJECTED */}
        <CoppaBanner />
        {/* main có overflow-y-auto để chỉ phần nội dung scroll, sidebar/topbar đứng yên */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
