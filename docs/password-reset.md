# Password reset

The login page links to `/forgot-password`. The email with the reset link is
sent by binge. itself, over the same SMTP as the invites, because Supabase's
built-in sender only reaches the Supabase team's own addresses.

## How it works

1. `/forgot-password` (`src/pages/PasswordReset.js`) posts the address to
   `POST /api/account/password-reset` (`server/routes/passwordReset.js`).
2. The server looks the account up (`profiles.email`), and with the service
   role calls `auth.admin.generateLink({ type: 'recovery' })`. That makes the
   account's one-time recovery token without sending anything.
3. `server/mailer.js` emails a link to the site itself:
   `{SITE_URL}/reset-password?token_hash=…&type=recovery`.
4. `/reset-password` trades the token for a session with
   `verifyOtp({ token_hash, type: 'recovery' })`, takes it out of the address,
   and `updateUser` saves the new password.

The link works once. Mail scanners that open links before the person does
(Outlook, some company filters) don't run the page's script, so they can't use
the token up the way they can with a link straight to Supabase.

**Same answer either way.** The page says "If an account exists for this
email…" whether or not one does, and the route answers the same, so the form
can't be used to find out who has an account.

**Limits.** 10 requests an hour per IP (per server instance), and at most one
email a minute per account, read from the account's `recovery_sent_at`, which
Supabase keeps. A second request within the minute gets the same answer and no
second email.

## Setting it up

- The server needs `SUPABASE_SERVICE_ROLE_KEY` and the `SMTP_*` variables
  (`docs/invite-only.md`). Links point at `SITE_URL`, or Vercel's production
  domain by default.
- Without either, the route answers `{ fallback: true }` and the page asks
  Supabase to send its own email (`resetPasswordForEmail`), as it did before.
  That email only reaches the Supabase team's addresses unless the same SMTP is
  also set in Supabase (Authentication → Emails → SMTP Settings). Its link goes
  through Supabase, so `/reset-password` must be listed under Authentication →
  URL Configuration → Redirect URLs (and `http://localhost:3000/reset-password`
  for local development).

No database migration is needed.

## Checking it

Request a reset for a test account on the live site, open the email's link,
set a new password, and sign in with it. Opening the same link again should say
it's invalid or expired. Automated tests (`src/pages/PasswordReset.test.js`,
`server/routes/passwordReset.test.js`) mock Supabase and send no email.

Reference: https://supabase.com/docs/guides/auth/passwords
