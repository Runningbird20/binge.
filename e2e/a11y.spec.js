// Accessibility: no serious or critical axe (WCAG 2.1 A/AA) violations on
// the main pages, plus the skip link and visible focus.
const { test, expect } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');
const { requireAccount } = require('./helpers');

test.beforeEach(() => requireAccount());

for (const path of ['/home', '/movies', '/search?q=dune', '/sports', '/settings', '/import', '/calendar']) {
  test(`no serious accessibility issues on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.locator('main').waitFor();
    await page.waitForTimeout(3000); // rows and images settle
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('iframe')
      .analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  });
}

test('keyboard users can skip to content and see focus', async ({ page }) => {
  await page.goto('/home');
  await page.locator('main').waitFor();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});
