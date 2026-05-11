/**
 * Smoke tests — kiểm tra app khởi động OK + middleware bảo vệ route.
 *
 * KHÔNG yêu cầu login để chạy — chỉ verify rằng:
 *   1. Trang chủ render (status 200)
 *   2. Vào route protected → redirect /sign-in?redirect=...
 *   3. Trang sign-in render OK
 *
 * Đủ để CI smoke-test sau mỗi deploy mà không cần seed DB.
 */
import { expect, test } from '@playwright/test';

test('homepage renders without error', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  // Smoke: ít nhất phải có 1 link hoặc body text
  await expect(page.locator('body')).toBeVisible();
});

test('protected route redirects unauthenticated user to sign-in', async ({ page }) => {
  await page.goto('/dashboard');
  // Middleware redirect → URL phải có /sign-in
  await page.waitForURL(/\/sign-in/);
  await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fdashboard/);
});

test('sign-in page renders form', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
