// Signs the test account in once and saves the session for every other
// test (storageState), so each spec starts signed in.
const fs = require('fs');
const path = require('path');
const { test: setup, expect } = require('@playwright/test');
const { hasAccount } = require('./helpers');

const STATE = path.join(__dirname, '.auth', 'user.json');

setup('sign in', async ({ page }) => {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  // Vercel previews sit behind Vercel login. With the project's automation
  // bypass secret, one request sets Vercel's bypass cookie; page.request shares
  // the browser's cookies, so it lands in the saved state for every spec.
  // (A header on every request would break Supabase/TMDB CORS preflights.)
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) {
    await page.request.get('/', {
      headers: { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' },
    });
  }
  if (!hasAccount) {
    // No account: save just the bypass cookie (if any) so signed-out specs still run.
    await page.context().storageState({ path: STATE });
    return;
  }
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/(home|profiles)/);
  if (page.url().includes('/profiles')) {
    await page.locator('.profile-picker-card, [data-profile-id], button').first().click();
    await page.waitForURL(/\/home/);
  }
  await expect(page.locator('main')).toBeVisible();
  await page.context().storageState({ path: STATE });
});
