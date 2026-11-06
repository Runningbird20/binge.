// Profile PINs end to end: lock a profile with a PIN, leave it, then pick it
// again on the profile picker. A wrong PIN is refused; the right one opens
// Home. Afterwards the PIN is removed (the same set_profile_lock RPC the Edit
// Profile page uses), so the test account is left as it was.
const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const { requireAccount } = require('./helpers');

const PIN = '4826';
const WRONG_PIN = '1357';
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.beforeEach(() => requireAccount());

async function signedInSupabase() {
  const supabase = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY,
  );
  await supabase.auth.signInWithPassword({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
  return supabase;
}

test('a profile locked with a PIN refuses a wrong PIN and opens with the right one', async ({ page }) => {
  // The first profile, from Manage Profiles.
  await page.goto('/profiles?manage=1');
  const editTile = page.getByRole('button', { name: /^Edit / }).first();
  const name = (await editTile.getAttribute('aria-label')).replace(/^Edit /, '');
  await editTile.click();
  await page.waitForURL(/\/profiles\/[^/?]+\/edit/);
  const profileId = page.url().match(/\/profiles\/([^/?]+)\/edit/)[1];

  try {
    // Set the PIN; saving asks for the account password.
    await page.getByLabel(/four-digit PIN$/i).fill(PIN);
    await page.getByLabel('Confirm PIN').fill(PIN);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByLabel('Account password').fill(process.env.E2E_PASSWORD);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForURL(/\/profiles\?manage=1/);

    // Leave it: back on the picker, the profile now says it's locked.
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}.*, locked with a PIN$`) }).click();
    await expect(page.getByRole('group', { name: `PIN for ${name}` })).toBeVisible();

    // A wrong PIN is refused, and the boxes clear for another try.
    await page.getByLabel('Digit 1 of 4').click();
    await page.keyboard.type(WRONG_PIN);
    await expect(page.getByRole('alert')).toContainText('Incorrect PIN');
    await expect(page.getByLabel('Digit 1 of 4')).toHaveValue('');

    // The right one opens the profile.
    await page.getByLabel('Digit 1 of 4').click();
    await page.keyboard.type(PIN);
    await page.waitForURL(/\/home/);
  } finally {
    const supabase = await signedInSupabase();
    const { error } = await supabase.rpc('set_profile_lock', { target_profile: profileId, new_pin: null });
    expect(error).toBeNull();
  }
});
