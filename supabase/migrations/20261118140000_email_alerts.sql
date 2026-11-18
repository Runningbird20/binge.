-- Email alerts, opt-in per account (off until chosen). Turned on in Settings,
-- or from the question asked the first time someone sets a reminder. With
-- them on, the server (server/routes/cron.js) emails reminders when they're
-- due and, once a day, a digest of new episodes and announcements the account
-- hasn't read in the app. No row means the account has never been asked; a
-- row with enabled = false means it said no or turned them off.
--
-- Its own table, not a column on profiles: profiles is readable by every
-- signed-in user, and this is the account's business alone.
create table if not exists public.email_alerts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.email_alerts enable row level security;
drop policy if exists email_alerts_read_own on public.email_alerts;
create policy email_alerts_read_own on public.email_alerts
  for select using (user_id = auth.uid());
drop policy if exists email_alerts_insert_own on public.email_alerts;
create policy email_alerts_insert_own on public.email_alerts
  for insert with check (user_id = auth.uid());
drop policy if exists email_alerts_update_own on public.email_alerts;
create policy email_alerts_update_own on public.email_alerts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.email_alerts from anon, authenticated;
grant select, insert, update on public.email_alerts to authenticated;

-- When an inbox alert went out in a digest, so the next one doesn't repeat it.
-- Written by the server only (the app may still change just read_at).
alter table public.notifications add column if not exists emailed_at timestamptz;
