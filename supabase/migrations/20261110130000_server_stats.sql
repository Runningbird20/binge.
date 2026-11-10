-- How fast each video server starts and how sharp it looks, per kind of
-- device, shared. Each TV app learns this from what it plays (the Apple TV's
-- ServerSpeed and QualityMemory); a new or reinstalled device starts from
-- what other devices of its kind measured, so its first play already goes to
-- the best server. One row per viewer per device kind per server; others
-- read only the medians (server_stats_summary).
create table if not exists public.server_stats (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device text not null check (device in ('apple-tv', 'fire-tv')),
  server text not null check (char_length(server) between 1 and 40),
  start_s real check (start_s is null or start_s between 0 and 120),
  quality integer check (quality is null or quality between 0 and 4320),
  updated_at timestamptz not null default now(),
  primary key (user_id, device, server)
);
alter table public.server_stats enable row level security;
drop policy if exists server_stats_own on public.server_stats;
create policy server_stats_own on public.server_stats for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Medians per server from the last 30 days, for one kind of device.
create or replace function public.server_stats_summary(p_device text)
returns table (server text, start_s real, quality integer, viewers integer)
language sql stable security definer set search_path = public as $$
  select s.server,
         (percentile_cont(0.5) within group (order by s.start_s))::real,
         (percentile_cont(0.5) within group (order by s.quality))::int,
         count(*)::int
  from public.server_stats s
  where s.device = p_device and s.updated_at > now() - interval '30 days'
  group by s.server;
$$;
grant execute on function public.server_stats_summary(text) to anon, authenticated;
