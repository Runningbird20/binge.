-- Invite-only sign-up (server/routes/invites.js, docs/invite-only.md).
--
-- Someone asks for an account on /signup (name, email, a note); the admin gets
-- an email with a link to approve or deny it, and an approved person gets an
-- email with a link back to /signup, where they create their account as before.
-- The server creates approved accounts with the service role; public sign-ups
-- are switched off in Supabase (Authentication → Sign In / Providers → "Allow
-- new users to sign up"), so nobody can skip the request.
--
-- Only the server reads or writes this table (RLS on, no policies, no grants),
-- like espn_credentials. Tokens are kept as SHA-256 hashes: the review token
-- is only in the admin's email, the invite token only in the requester's.
create table if not exists public.account_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null default '',
  note text not null default '',
  -- pending → approved → used (an account was made), or pending → denied
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'used')),
  review_token_hash text not null unique,
  invite_token_hash text unique,
  invite_expires_at timestamptz,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  used_at timestamptz
);

-- One open request per address: asking again while one is pending or approved
-- doesn't email the admin again.
create unique index if not exists idx_account_requests_open_email
  on public.account_requests (lower(email)) where status in ('pending', 'approved');
create index if not exists idx_account_requests_created on public.account_requests (created_at desc);

alter table public.account_requests enable row level security;
revoke all on public.account_requests from anon, authenticated;
