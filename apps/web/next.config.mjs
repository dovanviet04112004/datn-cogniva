/**
 * Cấu hình Next.js cho apps/web.
 *
 * - reactStrictMode: bật để bắt side-effect kép trong dev.
 * - typedRoutes: tạm tắt vì roadmap còn nhiều route stub (`/quiz`,
 *   `/flashcards`, `/chat`…) chưa có file → bật sẽ fail typecheck. Bật lại
 *   khi map route đã ổn định (~Phase 5 trong plan.md §10).
 * - transpilePackages: cần thiết để Next.js compile mã TS của
 *   `@cogniva/db` (workspace package) thay vì yêu cầu pre-build.
 * - images.remotePatterns: whitelist domain ảnh được tối ưu qua next/image.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  // typedRoutes: re-enable once the full route map is built out (~Phase 5).
  transpilePackages: ['@cogniva/db'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }],
  },
};

export default nextConfig;
