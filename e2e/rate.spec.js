// Rating: tap 4 stars on a title, see it saved, then clean up.
const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const { requireAccount, findMovieUrl } = require('./helpers');

test.beforeEach(() => requireAccount());

test('rating a movie saves it', async ({ page }) => {
  const url = await findMovieUrl(page);
  const mediaId = Number(url.split('/').pop());
  await page.goto(url);

  await page.getByRole('button', { name: 'Rate 4 stars' }).first().click();
  await expect(page.getByText(/rating saved/i)).toBeVisible();

  // Clean up so the test account stays empty.
  const supabase = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY,
  );
  await supabase.auth.signInWithPassword({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
  const { data: { user } } = await supabase.auth.getUser();
  const { data: saved } = await supabase.from('movie_ratings').select('acting').eq('user_id', user.id).eq('media_id', mediaId);
  expect(saved?.length).toBeGreaterThan(0);
  expect(Number(saved[0].acting)).toBe(4);
  await supabase.from('movie_ratings').delete().eq('user_id', user.id).eq('media_id', mediaId);
});
