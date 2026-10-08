// Sign up: fills the real form and checks the request binge. sends, without
// creating an account (the Supabase call is intercepted).
const { test, expect } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });

test('sign up sends the account details and shows server errors', async ({ page }) => {
  let sent = null;
  await page.route('**/auth/v1/signup**', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ code: 422, error_code: 'user_already_exists', msg: 'User already registered' }),
    });
  });

  await page.goto('/signup');
  await page.getByLabel('Username').fill('e2e_viewer');
  await page.getByLabel('Email').fill('e2e-viewer@example.com');
  await page.getByLabel('Bio').fill('Testing the sign-up flow.');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: /create account/i }).click();

  await expect.poll(() => sent).not.toBeNull();
  expect(sent.email).toBe('e2e-viewer@example.com');
  expect(sent.data?.username || sent.options?.data?.username).toBe('e2e_viewer');
  // The friendly error is shown and we stay on the form.
  await expect(page.getByText(/already|registered|exists/i).first()).toBeVisible();
  await expect(page).toHaveURL(/\/signup/);
});
