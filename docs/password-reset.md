# Supabase password reset

The login page links to `/forgot-password`, which calls Supabase Auth's
`resetPasswordForEmail`. Email links return to `/reset-password`, where the
Supabase SDK restores the session and `updateUser` saves the new password.
No database migration is required. This resets Supabase Auth accounts only;
accounts that exist only in Neon Auth are not affected.

In Supabase Dashboard → Authentication → URL Configuration:

- Set Site URL to the production app origin.
- Add `https://YOUR_APP_DOMAIN/reset-password` to Redirect URLs.
- For local development, add `http://localhost:3000/reset-password` (or the
  actual development origin).

Ensure the Supabase email provider and SMTP delivery are configured for your
users. The frontend uses the existing REACT_APP_SUPABASE_URL and
REACT_APP_SUPABASE_ANON_KEY configuration; no service-role key is needed.

To verify delivery, request a reset for a test Supabase account, follow the
email link, set a new password, and confirm login with it. Also try an expired
link. Automated tests mock Supabase and do not send real emails.

Reference: https://supabase.com/docs/guides/auth/passwords
