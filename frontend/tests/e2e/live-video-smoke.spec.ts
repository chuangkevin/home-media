import { test, expect } from '@playwright/test';
import { searchTrack, waitForMainReady } from './helpers';

test('video mode can be opened from live lyrics drawer without stalling on loading state', async ({ page }) => {
  await page.goto('/');
  await waitForMainReady(page);

  await searchTrack(page, 'Maroon 5 Sugar');
  await expect(page.locator('body')).toContainText(/Maroon 5|Sugar/, { timeout: 60_000 });

  await page.getByRole('button', { name: /Maroon 5 - Sugar|Sugar/i }).last().click();
  await expect(page.locator('body')).toContainText(/Maroon 5|Sugar/, { timeout: 60_000 });

  const videoTabVisible = await page.getByRole('button', { name: '影片' }).isVisible().catch(() => false);
  if (!videoTabVisible) {
    await expect(page.getByRole('button', { name: '影片' })).toBeVisible({ timeout: 60_000 });
  }

  await expect(page.getByRole('button', { name: '影片' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: '影片' }).click();

  await expect(page.locator('body')).not.toContainText('載入 YouTube 影片...', { timeout: 20_000 });
  await page.waitForTimeout(10000);
  await expect(page.locator('body')).not.toContainText('載入 YouTube 影片...');
  await expect(page.locator('body')).not.toContainText('下載中...');
});
