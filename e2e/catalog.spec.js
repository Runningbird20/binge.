// The database split, end to end: signed in, the browse rows come from the
// catalog (Turso, through /api/catalog) matched to TMDB's lists. A broken or
// empty catalog shows as rows without titles (an empty preview once did
// exactly that), so check there are titles and the catalog never failed.
const { test, expect } = require('@playwright/test');
const { requireAccount } = require('./helpers');

test.beforeEach(() => requireAccount());

for (const path of ['/home', '/movies']) {
  test(`${path} shows rows of titles from the catalog`, async ({ page }) => {
    const answers = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith('/api/catalog/')) answers.push(response);
    });
    await page.goto(path);

    const cards = page.locator('section.st-row a.st-card');
    await expect(cards.first()).toBeVisible();
    await expect.poll(() => cards.count()).toBeGreaterThan(5);
    const names = await cards.evaluateAll((links) => links.slice(0, 10).map((link) => link.getAttribute('aria-label')));
    expect(names.every(Boolean)).toBe(true);
    await expect(page.locator('.st-row--problem')).toHaveCount(0); // no "couldn't load this row"

    // The catalog answered. "Expected one row" (PGRST116) is a normal answer
    // to a single-row lookup; anything else that isn't a 200 is a failure.
    expect(answers.length).toBeGreaterThan(0);
    const failures = [];
    for (const response of answers) {
      if (response.status() === 200) continue;
      const body = await response.json().catch(() => null);
      if (body?.error?.code !== 'PGRST116') failures.push(`${response.status()} ${response.url()} ${JSON.stringify(body)}`);
    }
    expect(failures).toEqual([]);
  });
}
