/**
 * Vitest config — chỉ chạy unit test trong src/, KHÔNG đụng e2e/.
 *
 * Vitest default sẽ pick up mọi `*.spec.ts` + `*.test.ts` → bao gồm
 * Playwright spec ở `e2e/` → fail vì cùng global `test()` nhưng API khác.
 * Phải exclude `e2e/**` rõ ràng.
 *
 * Phase 0 chưa có unit test nào — config này sẵn sàng khi viết unit test
 * cho lib/ helpers (BKT, FSRS, cloze parser, etc.).
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Sync với tsconfig paths — `@/x` → `src/x`
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.next/**'],
    // Phase 0 chưa có unit test — không fail CI khi rỗng
    passWithNoTests: true,
  },
});
