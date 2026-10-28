-- Neon keeps the media catalog only (see docs/database-split.md). Accounts and
-- every user-owned table live in Supabase, so the copies here are dropped.
-- Run by .github/workflows/database-split.yml after a backup branch is made.
-- The transaction aborts if any catalog table loses a row.

begin;

create temp table media_counts_before on commit drop as
select 'movies' as t, count(*) as n from public.movies
union all select 'tv_shows', count(*) from public.tv_shows
union all select 'books', count(*) from public.books
union all select 'title_ratings', count(*) from public.title_ratings
union all select 'episode_ratings_cache', count(*) from public.episode_ratings_cache
union all select 'subtitle_cache', count(*) from public.subtitle_cache;

-- User and operational tables (dropped together, so no CASCADE is needed).
drop table if exists
  public.account_profiles, public.app_media, public.app_watchlist, public.avatar_files,
  public.book_ratings, public.continue_watching, public.episode_markers, public.episode_progress,
  public.error_events, public.espn_credentials, public.fantasy_leagues, public.followed_teams,
  public.follows, public.game_alerts_sent, public.media_list_votes, public.media_lists,
  public.movie_ratings, public.posts, public.profile_locks, public.profile_shares, public.profiles,
  public.push_notified, public.push_subscriptions, public.recommendation_hidden,
  public.server_config, public.server_status, public.site_announcements, public.stream_reports,
  public.tv_show_ratings, public.watch_reminders, public.watch_rooms, public.watchlist;

-- Copies of Supabase's Auth/Storage/Realtime schemas and the unused Neon Auth
-- accounts. Whole schemas need CASCADE; the media check below guards public.
drop schema if exists auth cascade;
drop schema if exists storage cascade;
drop schema if exists realtime cascade;
drop schema if exists vault cascade;
drop schema if exists supabase_migrations cascade;
drop schema if exists graphql cascade;
drop schema if exists graphql_public cascade;
drop schema if exists pgbouncer cascade;
drop schema if exists neon_auth cascade;

-- Functions over user data. search_catalog and fuzzy_search stay (catalog only).
do $$
declare fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'admin_stats', 'collaborative_book_candidates', 'collaborative_movie_candidates',
        'collaborative_tv_candidates', 'episode_marker_summary', 'handle_auth_user_account_profile',
        'handle_auth_user_changed', 'is_admin', 'is_list_collaborator', 'is_list_owner',
        'is_list_public', 'stream_provider_health', 'stream_report_summary', 'set_updated_at',
        'list_profile_locks', 'set_profile_lock', 'verify_profile_pin'
      )
  loop
    execute 'drop function ' || fn;
  end loop;
end $$;

do $$
declare lost text;
begin
  select string_agg(b.t, ', ') into lost
  from media_counts_before b
  join (
    select 'movies' as t, count(*) as n from public.movies
    union all select 'tv_shows', count(*) from public.tv_shows
    union all select 'books', count(*) from public.books
    union all select 'title_ratings', count(*) from public.title_ratings
    union all select 'episode_ratings_cache', count(*) from public.episode_ratings_cache
    union all select 'subtitle_cache', count(*) from public.subtitle_cache
  ) a using (t)
  where a.n <> b.n;
  if lost is not null then
    raise exception 'media tables changed during cleanup: %', lost;
  end if;
  if to_regclass('public.movie_genres') is null
     or to_regclass('public.tv_show_genres') is null
     or to_regclass('public.book_genres') is null then
    raise exception 'genre views were dropped';
  end if;
end $$;

commit;
