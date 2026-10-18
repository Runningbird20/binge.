// Play and resume: opening a title, the Resume label for a saved position,
// and the player loading an embed server.
const { test, expect } = require('@playwright/test');
const { requireAccount, findMovieUrl } = require('./helpers');

const SERVER_HOSTS = /vidrift|vidy|vidlink|cinesrc|vidsrc|videasy|2embed|vsembed/;

test.beforeEach(() => requireAccount());

test('a saved position shows Resume with time left, and Play opens the player', async ({ page }) => {
  const url = await findMovieUrl(page);
  const id = url.split('/').pop();

  // Pretend we stopped 30 minutes into a 2h19m film on this profile.
  await page.evaluate((movieId) => {
    // Same key as src/utils/playbackPositions.js (per active profile).
    const storeKey = `binge:positions:${window.localStorage.getItem('activeProfileId') || 'default'}`;
    const store = JSON.parse(window.localStorage.getItem(storeKey) || '{}');
    store[`movie:${movieId}`] = { t: 1800, d: 8340, at: Date.now() };
    window.localStorage.setItem(storeKey, JSON.stringify(store));
  }, id);

  await page.goto(url);
  const play = page.locator('.td-play');
  await expect(play).toContainText(/Resume/);
  await expect(play).toContainText(/left/);

  await play.click();
  const frame = page.locator('[data-embed-player] iframe').first();
  await expect(frame).toBeVisible();
  await expect.poll(async () => frame.getAttribute('src')).toMatch(SERVER_HOSTS);

  // Esc closes the player and returns to the title.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-embed-player]')).toHaveCount(0);
});
