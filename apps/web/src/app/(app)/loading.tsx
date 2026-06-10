/**
 * loading.tsx — Skeleton hiện TỨC THÌ khi điều hướng giữa các trang trong (app).
 *
 * Next App Router tự bọc page con trong 1 Suspense boundary với fallback này. Hệ quả:
 *  - Khi user bấm sang trang khác: AppSidebar + AppTopbar (thuộc layout) GIỮ NGUYÊN,
 *    vùng nội dung hiện skeleton NGAY LẬP TỨC thay vì "đợi server render xong cả trang
 *    rồi mới nhảy" → cảm giác "hiện dần", phản hồi tức thì.
 *  - Khi tải nguyên trang (refresh): vỏ (layout) + skeleton này được stream ra trước,
 *    nội dung page (await data) stream vào sau khi resolve.
 *
 * Đặc biệt quan trọng khi data đi Neon xa / cold-start: trước đây mỗi click chờ trắng
 * vài trăm ms→vài giây rồi mới thấy gì; giờ thấy khung ngay.
 *
 * Đây là skeleton GENERIC (tiêu đề + card thống kê + danh sách) dùng chung mọi route
 * con. Route nặng/khác layout có thể thêm `loading.tsx` riêng cạnh page để khớp hơn
 * (vd dashboard/loading.tsx) — Next dùng loading.tsx GẦN NHẤT.
 */
import { Skeleton } from '@/components/ui/skeleton';

export default function AppLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6"
      aria-busy="true"
      aria-live="polite"
    >
      {/* Tiêu đề trang */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Hàng card thống kê (dashboard/analytics-style) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>

      {/* Khối nội dung chính (list/feed-style) */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
