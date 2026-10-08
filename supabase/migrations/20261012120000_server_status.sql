-- Streaming-server uptime: one row per provider, written by the server's
-- health check (/api/cron/health, also run every 15 min from the
-- reminders job) with the service role. Readable by anyone so the player
-- and the admin page can show it.
create table if not exists public.server_status (
  provider text primary key,
  label text,
  status text not null default 'unknown' check (status in ('up', 'slow', 'down', 'unknown')),
  http_status integer,
  latency_ms integer,
  detail text,
  reports_broken_24h integer not null default 0,
  reports_works_24h integer not null default 0,
  fail_count integer not null default 0,     -- consecutive failed probes
  alerted_down boolean not null default false,
  checked_at timestamptz,
  changed_at timestamptz
);
alter table public.server_status enable row level security;
drop policy if exists server_status_read on public.server_status;
create policy server_status_read on public.server_status for select using (true);
