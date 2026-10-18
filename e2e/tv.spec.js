// TV remote: d-pad only. Moves through Home, opens a title (Play is
// focused), starts the player (the video takes the remote), and Back steps
// out of the video, closes the player, then the sheet.
const { test, expect } = require('@playwright/test');
const { requireAccount } = require('./helpers');

test.beforeEach(() => requireAccount());

const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el && el !== document.body ? `${el.tagName}|${el.className}|${el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30)}` : 'BODY';
});

test('browse, open and play with only the remote', async ({ page }) => {
  await page.goto('/home');
  await expect(page.locator('html')).toHaveClass(/tv-mode/);
  await expect(page.locator('.bottom-nav')).toHaveCount(0);

  // Something is focused without touching anything.
  await expect.poll(() => focused(page)).not.toBe('BODY');

  // Walk down until a title card has focus.
  for (let i = 0; i < 10 && !(await focused(page)).includes('st-card'); i += 1) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
  }
  expect(await focused(page)).toContain('st-card');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');

  // Title sheet opens with Play focused.
  await expect(page.locator('.td-modal')).toBeVisible();
  await expect.poll(() => focused(page)).toMatch(/td-play/);
  await page.keyboard.press('Enter');

  // The video takes the remote once it loads.
  await expect(page.locator('[data-embed-player]')).toBeVisible();
  await expect.poll(() => focused(page), { timeout: 20_000 }).toMatch(/^IFRAME/);

  // Back ×3: out of the video, close the player, close the sheet.
  expect(await page.evaluate(() => window.bingeTvBack())).toBe(true);
  await expect.poll(() => focused(page)).not.toMatch(/^IFRAME/);
  expect(await page.evaluate(() => window.bingeTvBack())).toBe(true);
  await expect(page.locator('[data-embed-player]')).toHaveCount(0);
  expect(await page.evaluate(() => window.bingeTvBack())).toBe(true);
  await expect(page.locator('.td-modal')).toHaveCount(0);
});
