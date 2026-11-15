// Invite-only sign-up (docs/invite-only.md): asking for an account, and making
// one from an invite link. Fills the real forms and checks what binge. sends,
// without saving a request or creating an account (the API is intercepted).
const { test, expect } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });

test('without an invite, /signup asks for an account', async ({ page }) => {
  let sent = null;
  await page.route('**/api/account/requests', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: /request an account/i })).toBeVisible();
  await page.getByLabel('Your name').fill('E2E Viewer');
  await page.getByLabel('Email').fill('e2e-viewer@example.com');
  await page.getByLabel(/anything we should know/i).fill('Testing the request flow.');
  await page.getByRole('button', { name: 'Request account' }).click();

  await expect.poll(() => sent).not.toBeNull();
  expect(sent).toEqual({ name: 'E2E Viewer', email: 'e2e-viewer@example.com', note: 'Testing the request flow.' });
  await expect(page.getByRole('status')).toContainText('e2e-viewer@example.com');
});

test('an invite opens the sign-up form for its address and shows server errors', async ({ page }) => {
  await page.route('**/api/account/invite?token=*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ email: 'e2e-viewer@example.com', name: 'E2E Viewer' }),
  }));
  let sent = null;
  await page.route('**/api/account/signup', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'That username is taken. Try another.' }) });
  });

  await page.goto('/signup?invite=e2e-invite-token-0000000000');
  await expect(page.getByLabel('Email')).toHaveValue('e2e-viewer@example.com');
  await page.getByLabel('Username').fill('e2e_viewer');
  await page.getByLabel('Bio').fill('Testing the sign-up flow.');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: /create account/i }).click();

  await expect.poll(() => sent).not.toBeNull();
  expect(sent.token).toBe('e2e-invite-token-0000000000');
  expect(sent.username).toBe('e2e_viewer');
  // The server's message is shown and we stay on the form.
  await expect(page.getByText(/username is taken/i)).toBeVisible();
  await expect(page).toHaveURL(/\/signup\?invite=/);
});
