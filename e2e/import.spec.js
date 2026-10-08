// History import: a Letterboxd ratings export is recognised, matched to the
// catalog and ready to import (stops before writing anything).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { requireAccount } = require('./helpers');

test.beforeEach(() => requireAccount());

test('a Letterboxd export is recognised and matched', async ({ page }) => {
  await page.goto('/import');
  await page.getByLabel('Choose export files').setInputFiles(path.join(__dirname, 'fixtures', 'letterboxd-ratings.csv'));
  await expect(page.getByRole('heading', { name: /Found 3 titles from Letterboxd/ })).toBeVisible();
  await expect(page.getByText(/3 rated/)).toBeVisible();

  await page.getByRole('button', { name: /find them on binge/i }).click();
  await expect(page.getByRole('heading', { name: /titles ready to import/ })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: /^Import \d+ titles$/ })).toBeEnabled();
});
