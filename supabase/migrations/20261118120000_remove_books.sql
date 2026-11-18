-- Books were removed from binge. (2026-11-18): the website, server, catalog
-- and TV apps no longer have them. This deletes everyone's book data and the
-- objects that held it. It can't be undone.
--   1. Book rows in every table with a media_type column (My List, Continue
--      Watching, reminders, shares, hidden picks, ...).
--   2. Checks on media_type that allowed 'book' lose it.
--   3. book_ratings and the book recommendation function go.
--   4. admin_stats stops counting book ratings (it read book_ratings).
-- Run it after the website without books is live: the old site still reads
-- and writes book rows.

-- 1 + 2. By lookup, because several of these checks were written inline and
-- named by the database, and one table (watch_rooms) isn't in this history.
do $$
declare
  t record;
  c record;
  def text;
begin
  for t in
    select col.table_name
    from information_schema.columns col
    join information_schema.tables tab
      on tab.table_schema = col.table_schema and tab.table_name = col.table_name
    where col.table_schema = 'public' and col.column_name = 'media_type' and tab.table_type = 'BASE TABLE'
  loop
    execute format('delete from public.%I where media_type = %L', t.table_name, 'book');
  end loop;

  for c in
    select con.oid, con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%media_type%'
      and pg_get_constraintdef(con.oid) like '%''book''%'
  loop
    -- e.g. CHECK ((media_type = ANY (ARRAY['movie'::text, 'tv_show'::text, 'book'::text])))
    def := regexp_replace(pg_get_constraintdef(c.oid), '(,\s*''book''(::text)?)|(''book''(::text)?\s*,\s*)', '', 'g');
    if def like '%''book''%' then
      raise exception 'Could not take book out of %.%: %', c.relname, c.conname, def;
    end if;
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
    execute format('alter table public.%I add constraint %I %s', c.relname, c.conname, def);
  end loop;
end $$;

-- 3. Plain statements (not in the block above) so
-- scripts/check-supabase-migrations.js sees them. No cascade: if anything
-- unexpected still depends on book_ratings, this stops instead of dropping it.
drop function if exists public.collaborative_book_candidates(uuid, uuid, integer);
drop table if exists public.book_ratings;

-- 4. admin_stats as in 20261028160000_media_moves_to_neon.sql, without book_ratings.
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with activity as (
    select user_id, updated_at as at from public.continue_watching where updated_at > now() - interval '30 days'
    union all
    select user_id, watched_at from public.episode_progress where watched_at > now() - interval '30 days'
    union all
    select user_id, created_at from public.movie_ratings where created_at > now() - interval '30 days'
    union all
    select user_id, created_at from public.tv_show_ratings where created_at > now() - interval '30 days'
  ),
  days as (
    select generate_series(current_date - 13, current_date, interval '1 day')::date as day
  ),
  top_titles as (
    select cw.media_type, cw.media_id, count(distinct cw.user_id) as viewers
    from public.continue_watching cw
    where cw.updated_at > now() - interval '7 days'
    group by 1, 2
    order by viewers desc
    limit 10
  )
  select jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'users_new_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'active_24h', (select count(distinct user_id) from activity where at > now() - interval '24 hours'),
    'active_7d', (select count(distinct user_id) from activity where at > now() - interval '7 days'),
    'active_30d', (select count(distinct user_id) from activity),
    'ratings_total', (select count(*) from public.movie_ratings) + (select count(*) from public.tv_show_ratings),
    'list_total', (select count(*) from public.watchlist),
    'push_devices', (select count(*) from public.push_subscriptions),
    'reminders_pending', (select count(*) from public.watch_reminders where sent_at is null and dismissed_at is null),
    'followed_teams', (select count(*) from public.followed_teams),
    'errors_24h', (select count(*) from public.error_events where created_at > now() - interval '24 hours' and not resolved),
    'signups_by_day', (
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(p.count, 0)) order by d.day)
      from days d
      left join (select created_at::date as day, count(*) from public.profiles group by 1) p on p.day = d.day
    ),
    'active_by_day', (
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(a.count, 0)) order by d.day)
      from days d
      left join (select at::date as day, count(distinct user_id) from activity group by 1) a on a.day = d.day
    ),
    'top_titles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'media_type', t.media_type, 'media_id', t.media_id, 'viewers', t.viewers
      ) order by t.viewers desc), '[]'::jsonb)
      from top_titles t
    )
  ) into result;
  return result;
end;
$$;
revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
