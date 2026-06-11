import { expect, test } from '@playwright/test';

test('/leaderboard accessible without login', async ({ page }) => {
  await page.goto('/leaderboard');
  await expect(page).toHaveURL(/\/leaderboard/);
  await expect(page.getByRole('heading', { name: /Leaderboard/i })).toBeVisible();
});

test('/profile/[fake-id] returns not-found UI (not auth redirect)', async ({ page }) => {
  await page.goto('/profile/this-user-does-not-exist-1234');
  await expect(page).toHaveURL(/\/profile\/this-user-does-not-exist-1234/);
  await expect(page.getByText(/Không tìm thấy profile/i)).toBeVisible();
});
