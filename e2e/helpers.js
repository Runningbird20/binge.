const { test } = require('@playwright/test');

const hasAccount = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

// Signed-in tests skip cleanly when no test account is configured.
function requireAccount() {
  test.skip(!hasAccount, 'Set E2E_EMAIL and E2E_PASSWORD (a dedicated test account) to run signed-in tests.');
}

// A well-known title that's in the catalog on every deployment.
const MOVIE_QUERY = 'Fight Club';

// Search for a title and return its catalog URL (/movie/123).
async function findMovieUrl(page, query = MOVIE_QUERY) {
  await page.goto(`/search?q=${encodeURIComponent(query)}`);
  const link = page.locator('.sr-top a', { hasText: 'Details' }).first();
  await link.waitFor();
  return new URL(await link.getAttribute('href'), page.url()).pathname;
}

module.exports = { hasAccount, requireAccount, findMovieUrl, MOVIE_QUERY };
