import { expect, test } from '@playwright/test';

test('homepage renders without error', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.locator('body')).toBeVisible();
});

test('protected route redirects unauthenticated user to sign-in', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForURL(/\/sign-in/);
  await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fdashboard/);
});

test('sign-in page renders form', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
