import { test, expect } from '@playwright/test';
import { searchTrack, waitForMainReady } from './helpers';

test('live lyrics flow shows whether lyrics load automatically or fail into manual search state', async ({ page }) => {
  await page.goto('/');
  await waitForMainReady(page);

  await searchTrack(page, 'Maroon 5 Sugar');
  await expect(page.locator('body')).toContainText(/Maroon 5|Sugar/, { timeout: 60_000 });

  await page.getByRole('button', { name: /Maroon 5 - Sugar|Sugar/i }).last().click();
  await expect(page.locator('body')).toContainText(/Maroon 5|Sugar/, { timeout: 60_000 });

  await page.locator('p').filter({ hasText: /Maroon 5 - Sugar|Sugar/i }).last().click();

  await expect(page.locator('body')).toContainText(/歌詞|搜尋其他歌詞|重新自動搜尋|無歌詞/, { timeout: 60_000 });
  const bodyText = await page.locator('body').textContent();
  console.log('\nLYRICS_STATE_START');
  console.log(bodyText);
  console.log('LYRICS_STATE_END\n');
});
