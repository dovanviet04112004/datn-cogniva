/**
 * Public routes test — verify /leaderboard và /profile/[id] không cần login.
 *
 * Đây là invariant của Phase 9 (gamification): public profile/leaderboard
 * phải accessible cho visitor anonymous.
 */
import { expect, test } from '@playwright/test';

test('/leaderboard accessible without login', async ({ page }) => {
  await page.goto('/leaderboard');
  // KHÔNG redirect về /sign-in
  await expect(page).toHaveURL(/\/leaderboard/);
  await expect(page.getByRole('heading', { name: /Leaderboard/i })).toBeVisible();
});

test('/profile/[fake-id] returns not-found UI (not auth redirect)', async ({ page }) => {
  await page.goto('/profile/this-user-does-not-exist-1234');
  // Vẫn ở /profile/... không bị redirect sign-in
  await expect(page).toHaveURL(/\/profile\/this-user-does-not-exist-1234/);
  // UI hiển thị message not found
  await expect(page.getByText(/Không tìm thấy profile/i)).toBeVisible();
});
