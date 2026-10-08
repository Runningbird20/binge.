// Signs the test account in once and saves the session for every other
// test (storageState), so each spec starts signed in.
const fs = require('fs');
const path = require('path');
const { test: setup, expect } = require('@playwright/test');
const { hasAccount } = require('./helpers');

const STATE = path.join(__dirname, '.auth', 'user.json');

setup('sign in', async ({ page }) => {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  if (!hasAccount) {
    // Empty state so signed-out specs still run.
    fs.writeFileSync(STATE, JSON.stringify({ cookies: [], origins: [] }));
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
