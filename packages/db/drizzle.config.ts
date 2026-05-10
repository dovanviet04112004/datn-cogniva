/**
 * Cấu hình cho drizzle-kit (CLI tạo migration + push schema).
 *
 * Cách dùng:
 *   pnpm db:generate  → sinh SQL migration từ schema.ts vào ./migrations
 *   pnpm db:push      → đẩy thẳng schema vào DB (chỉ dùng trong dev)
 *   pnpm db:migrate   → áp dụng migration đã generate (dùng khi production)
 *   pnpm db:studio    → mở Drizzle Studio (UI quản lý DB cục bộ)
 *
 * Lưu ý: file này KHÔNG được import trong runtime của app — drizzle-kit đọc
 * trực tiếp qua đường dẫn ./packages/db/drizzle.config.ts.
 */
import { defineConfig } from 'drizzle-kit';

// Bắt buộc phải có DATABASE_URL — fail-fast để tránh push nhầm vào DB rỗng/sai
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run drizzle-kit');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // strict: yêu cầu xác nhận trước khi xoá column / drop table — tránh mất data
  strict: true,
  verbose: true,
});
