# Invite-only accounts

binge. accounts are by request. Nobody can make an account without the admin's approval.

## How it works

1. **Asking.** `/signup` without an invite is the **Request an account** form (name, email, an optional note). The request is saved in `account_requests`, and the admin gets an email with a link to approve or deny it.
2. **Deciding.** The link opens `/account-requests/review?token=…`, which works without signing in (the token is the permission), with **Approve** and **Deny** buttons. Admins can also decide in **Admin → Requests**, which lists every request.
3. **Approving** emails the person their invite ("Your binge. invite"): a link to `/signup?invite=…`, valid for 14 days.
4. **Signing up.** That link opens the regular sign-up form (username, bio, avatar, password) with their email filled in and locked. The server creates the account (`POST /api/account/signup`, service role, email already confirmed by the invite), marks the request used, and the page signs them in.

Code: `server/routes/invites.js` (+ `invites.test.js`), `server/mailer.js`, `src/utils/accountRequests.js`, `src/pages/Signup.js`, `src/pages/AccountRequestReview.js`, `src/pages/admin/AdminRequestsPanel.js`; table in `supabase/migrations/20261110140000_account_requests.sql`.

**Safety:**
- Tokens are 32 random bytes, and only their hashes are stored. The review token is only in the admin's email, the invite token only in the requester's.
- Email links use `SITE_URL` (or Vercel's production domain), never the request's own address, so a forged request can't send the admin's token elsewhere.
- The request form answers the same whether or not the address already has an account.
- Request limits: 5 an hour from one address. Past 20 in an hour, requests are saved but don't email the admin.
- Accounts are only made by the server, which never puts `is_admin` in the new account's metadata. The profile trigger used to trust that field from public sign-ups.

## Setup (once)

1. **Run the migration** `supabase/migrations/20261110140000_account_requests.sql` in the Supabase SQL editor (or `npm run supabase:sql -- supabase/migrations/20261110140000_account_requests.sql` with `SUPABASE_DB_URL` set).
2. **Email.** Set these in Vercel (Project → Settings → Environment Variables) and in `.env` for local runs:
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. With Gmail:
     - Turn on 2-Step Verification for the Google account.
     - Create an app password (Google Account → Security → App passwords).
     - Use `smtp.gmail.com`, port `465`, the Gmail address as user and the app password as password.
   - `ACCOUNT_REQUESTS_TO`: where requests go (comma-separated). If empty, every admin account's email.
   - `SITE_URL`: the site's address for links, for example `https://binge-26.vercel.app`. Optional on Vercel.

   Without email, everything still works: requests show in Admin → Requests, and approving shows the invite link to send by hand.

   **Keeping them out of spam.** The emails are short plain-text notes with one link, on purpose. The earlier designed version (an HTML template with a big "Create your account" button) went to Gmail's spam as "similar to messages that were identified as spam in the past".
   - Local runs without `SITE_URL` link to `http://localhost:3000`, which looks worse still, so judge delivery from the live site.
   - Have recipients mark the first one "Not spam".
   - If invites still land in spam, the lasting fix is a domain of your own for the site and for sending email.
3. **Deploy**, then **turn off public sign-ups** in Supabase: Authentication → Sign In / Providers → turn off **Allow new users to sign up**. The server's service role can still create accounts. Until this is off, someone could still call Supabase's sign-up directly.
4. **Optional:** use the same SMTP for Supabase's own emails (Authentication → Emails → SMTP Settings). Supabase's built-in sender only delivers to your Supabase team's addresses, so password-reset emails need it to reach everyone else.

## Admin-made accounts

**Admin → Users → New user** creates an account through the server (`POST /api/admin/users`) and can make it an admin in the same step. It needs no request.
