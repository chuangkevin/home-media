import { expect, Page } from '@playwright/test';

export async function waitForMainReady(page: Page): Promise<void> {
  await expect(page.locator('body')).toContainText(/為您推薦|播放清單|最近播放|搜尋音樂/, { timeout: 60_000 });
}

export async function searchTrack(page: Page, query: string): Promise<void> {
  const searchInput = page.getByPlaceholder('搜尋音樂...');
  await expect(searchInput).toBeVisible({ timeout: 60_000 });
  await searchInput.fill(query);
  await page.keyboard.press('Enter');
}
