-- Subtitle timing, shared. The TV apps draw OpenSubtitles files over the
-- servers' streams; a file made for another cut of the video (an extra
-- logo, a recap) is off by the same gap all the way through. When a viewer
-- shifts the subtitles and leaves them there, their shift is saved here, per
-- subtitle file (its release name) and server, and every viewer after them
-- starts in sync. One row per viewer per file+server; others read only the
-- median (subtitle_sync_summary), never anyone's rows.
create table if not exists public.subtitle_sync (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv_show')),
  media_id bigint not null,
  season integer not null default 0,
  episode integer not null default 0,
  lang text not null check (char_length(lang) between 2 and 8),
  release text not null check (char_length(release) <= 300),
  server text not null check (char_length(server) <= 40),
  offset_s real not null check (offset_s between -60 and 60),
  updated_at timestamptz not null default now(),
  primary key (user_id, media_type, media_id, season, episode, lang, release, server)
);
create index if not exists subtitle_sync_file_idx
  on public.subtitle_sync (media_type, media_id, season, episode, lang, release, server);
alter table public.subtitle_sync enable row level security;
drop policy if exists subtitle_sync_own on public.subtitle_sync;
create policy subtitle_sync_own on public.subtitle_sync for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The median shift viewers chose for this file on this server.
create or replace function public.subtitle_sync_summary(
  p_media_type text, p_media_id bigint, p_season integer, p_episode integer,
  p_lang text, p_release text, p_server text
) returns table (offset_s real, viewers integer)
language sql stable security definer set search_path = public as $$
  select percentile_cont(0.5) within group (order by s.offset_s)::real, count(*)::int
  from public.subtitle_sync s
  where s.media_type = p_media_type and s.media_id = p_media_id
    and s.season = p_season and s.episode = p_episode
    and s.lang = p_lang and s.release = p_release and s.server = p_server
  having count(*) > 0;
$$;
grant execute on function public.subtitle_sync_summary(text, bigint, integer, integer, text, text, text) to anon, authenticated;
