import { test, expect } from '@playwright/test';
import { searchTrack, waitForMainReady } from './helpers';

test('live app loads search and recommendation surfaces', async ({ page }) => {
  await page.goto('/');
  await waitForMainReady(page);

  await expect(page.locator('body')).toContainText(/為您推薦|播放清單|最近播放/);
  await searchTrack(page, 'Maroon 5 Sugar');
  await expect(page.locator('body')).toContainText(/Maroon 5|Sugar/, { timeout: 60_000 });
});
