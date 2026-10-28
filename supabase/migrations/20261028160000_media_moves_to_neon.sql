-- The media catalog lives in Neon (see docs/database-split.md). Supabase keeps
-- Auth and every user-owned table, so the catalog copies here are dropped.
-- Run only after the web app and TV apps that read media from /api/neon-data
-- are deployed: older clients read these tables directly.

-- admin_stats used to join titles; the admin page now looks them up in Neon.
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
    'ratings_total', (select count(*) from public.movie_ratings) + (select count(*) from public.tv_show_ratings) + (select count(*) from public.book_ratings),
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

do $$
declare fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('search_catalog', 'fuzzy_search')
  loop
    execute 'drop function ' || fn;
  end loop;
end $$;

drop view if exists public.movie_genres;
drop view if exists public.tv_show_genres;
drop view if exists public.book_genres;

drop table if exists public.title_ratings;
drop table if exists public.episode_ratings_cache;
drop table if exists public.subtitle_cache;
drop table if exists public.movies;
drop table if exists public.tv_shows;
drop table if exists public.books;
