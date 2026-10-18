-- Subtitle files from OpenSubtitles, fetched once by the server
-- (/api/extras/subtitles) and shared by every viewer: the free API only
-- allows a few downloads a day. Written and read with the service role only.
create table if not exists public.subtitle_cache (
  key text primary key,            -- movie|tv : tmdb : season : episode : lang : version
  vtt text not null,
  release text,
  versions integer,
  created_at timestamptz not null default now()
);
alter table public.subtitle_cache enable row level security;
