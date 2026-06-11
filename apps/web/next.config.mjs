/**
 * Cấu hình Next.js cho apps/web.
 *
 * - reactStrictMode: bật để bắt side-effect kép trong dev.
 * - typedRoutes: tạm tắt vì roadmap còn nhiều route stub (`/quiz`,
 *   `/flashcards`, `/chat`…) chưa có file → bật sẽ fail typecheck. Bật lại
 *   khi map route đã ổn định (~Phase 5 trong docs/plans/master.md §10).
 * - transpilePackages: cần thiết để Next.js compile mã TS của
 *   `@cogniva/db` (workspace package) thay vì yêu cầu pre-build.
 * - images.remotePatterns: whitelist domain ảnh được tối ưu qua next/image.
 *
 * @type {import('next').NextConfig}
 */
/**
 * Strangler-fig proxy (docs/plans/nestjs-migration.md §2.2): các prefix đã
 * migrate sang NestJS (:4000) được rewrite TRƯỚC filesystem route (beforeFiles
 * thắng cả route.ts còn tồn tại) → cutover an toàn, rollback = xoá 1 dòng.
 * Prod VPS dùng rule tương đương ở Caddy — danh sách này chỉ phục vụ dev.
 */
const NEST_ORIGIN = process.env.NEST_API_ORIGIN ?? 'http://localhost:4000';
const NEST_MIGRATED_PREFIXES = [
  'healthz', // Wave 0 — health của NestJS
  'auth/google', // Wave 1 — OAuth mới (path KHÁC callback/google của Better Auth)
  'profile', // Wave 2 — UsersModule (golden diff pass, route cũ đã xóa)
  'user/status', // Wave 2 — UsersModule
  'leaderboard', // Wave 2 — GamificationModule
  'analytics', // Wave 2 — GamificationModule
  'mastery', // Wave 2b — LearningModule (golden diff 19/19)
  'atoms', // Wave 2b — LearningModule
  'notes', // Wave 2b — LearningModule
  'study-plan', // Wave 2b — LearningModule
  'graph', // Wave 2b — GraphModule
  'search', // Wave 2b — SearchModule
  'chunks', // Wave 2b — SearchModule
  'workspaces', // Wave 3 — WorkspacesModule (golden diff 64/64)
  'documents', // Wave 3 — DocumentsModule (upload + ingest + file proxy)
  'flashcards', // Wave 3 — FlashcardsModule (FSRS + ảnh R2)
  'quiz', // Wave 3 — QuizModule
  'exams', // Wave 3 — ExamsModule
  'attempts', // Wave 3 — ExamsModule (attempts controller)
  'conversations', // Wave 3 — ConversationsModule (POST /api/chat vẫn ở Next tới W7)
  'groups', // Wave 4 — GroupsModule (golden diff 98/98)
  'dm', // Wave 4 — GroupsModule (DM controller)
  'channels', // Wave 4 — ChannelsModule + ChannelsVoiceModule
  'rooms', // Wave 4 — RoomsModule
  'notifications', // Wave 4 — NotificationsModule
  'reports', // Wave 4 — NotificationsModule (reports controller)
  'realtime', // Wave 4 — RealtimeModule (gateway auth endpoint)
  'questions', // Wave 4 catch-up — QuizModule (questions/:id/grade)
  'library', // Wave 5 — 3 module Library (golden diff 42/42, có bug-fix import)
  'tutoring', // Wave 6 — Bookings/Market/Concierge (golden diff 65/65)
  'tutors', // Wave 6 — TutorsModule
  'wallet', // Wave 6 — PaymentsModule (WalletService đầy đủ)
  'webhooks', // Wave 6 — VNPay/MoMo/LiveKit (replay signed fixtures + idempotency)
  'chat', // Wave 7 — ChatModule (AI SDK v4 data stream, golden diff 56/56)
  'ai', // Wave 7 — quick-gen (router DI)
  'admin', // Wave 7 — AdminCore + AdminDomain (40 routes)
  'account', // Wave 7 — AccountModule (GDPR delete/export/usage/push-token)
  'health', // Wave 7 — health tổng (db/redis/storage checks)
];
// Path EXACT (không wildcard) — các path auth mới phải match đúng để KHÔNG
// nuốt path Better Auth còn dùng (sign-in/email của admin page, two-factor/*,
// get-session…). Better Auth catch-all chỉ gỡ ở cuối GĐ1.
const NEST_MIGRATED_EXACT = [
  'auth/sign-in',
  'auth/sign-in/2fa',
  'auth/sign-up',
  'auth/refresh',
  'auth/sign-out',
  'auth/me',
  'auth/forgot-password',
  'auth/reset-password',
  'auth/2fa/enable', // Wave 7 — 2FA manage (admin), thay authClient.twoFactor.*
  'auth/2fa/verify',
  'auth/2fa/disable',
];

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [
        ...NEST_MIGRATED_PREFIXES.map((p) => ({
          source: `/api/${p}/:path*`,
          destination: `${NEST_ORIGIN}/api/${p}/:path*`,
        })),
        ...NEST_MIGRATED_PREFIXES.map((p) => ({
          source: `/api/${p}`,
          destination: `${NEST_ORIGIN}/api/${p}`,
        })),
        ...NEST_MIGRATED_EXACT.map((p) => ({
          source: `/api/${p}`,
          destination: `${NEST_ORIGIN}/api/${p}`,
        })),
      ],
    };
  },
  // ESLint KHÔNG chặn `next build`. Các warning hiện tại (unused-var,
  // consistent-type-imports) thuần style, 0 ảnh hưởng runtime — nhưng nếu để mặc
  // định, `next build` FAIL trên chúng → VPS không build/deploy được. Lint vẫn chạy
  // riêng qua `pnpm lint` / CI / pre-commit. (typecheck giữ NGUYÊN — type vẫn được
  // kiểm lúc build.) Pattern chuẩn nhiều team prod.
  eslint: { ignoreDuringBuilds: true },
  // typedRoutes: re-enable once the full route map is built out (~Phase 5).
  transpilePackages: ['@cogniva/db', '@cogniva/shared'],
  // Cho phép truy cập dev qua tunnel HTTPS (cloudflared/ngrok) để test trên điện
  // thoại thật — nếu không khai báo, Next 15.5 chặn asset/HMR cross-origin.
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.app', '*.ngrok.io'],
  experimental: {
    // Client Router Cache: Next 15 mặc định dynamic=0s → MỖI lần điều hướng
    // (đổi channel, vào/ra forum, back/forward) đều fetch lại RSC từ server →
    // nhấp nháy "tải lại trang". Đặt cửa sổ cache ngắn để re-visit/back trong
    // khoảng này dùng lại payload đã cache (điều hướng tức thì như Discord),
    // vẫn đủ ngắn để không thấy data quá cũ. Mutation vẫn gọi router.refresh()
    // để bust cache route hiện tại.
    staleTimes: {
      dynamic: 60,
      static: 180,
    },
    // Barrel-import optimization: với package export gom (named import kéo cả
    // module), Next rewrite sang import trực tiếp từng submodule → tree-shake tốt
    // hơn, giảm JS gửi xuống client. CHỈ liệt kê package client-impactful CÓ
    // barrel export và CHƯA nằm trong default list của Next (lucide-react,
    // @radix-ui/* đã được Next tự tối ưu nên không thêm lại). An toàn: chỉ đổi
    // cách resolve import, không đổi hành vi runtime.
    optimizePackageImports: [
      '@tanstack/react-query',
      '@tiptap/react',
      '@tiptap/starter-kit',
      'yjs',
    ],
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }],
  },
};

export default nextConfig;
