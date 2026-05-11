/**
 * Playwright config — E2E test cho Cogniva web app.
 *
 * Chạy:
 *   pnpm --filter=@cogniva/web test:e2e
 *
 * Test ở chế độ headed (mở browser thật) khi debug bằng `--headed`.
 *
 * Note: webServer config tự `pnpm dev` khi cần — KHÔNG dùng trong CI nếu
 * đã có dev server đang chạy. Set `reuseExistingServer: !process.env.CI`.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
