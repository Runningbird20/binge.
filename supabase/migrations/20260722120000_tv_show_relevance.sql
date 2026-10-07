-- Mirrors the movies table's relevance columns (see
-- 20260429100000_movie_relevance_omdb.sql) so tv_shows can be ranked by
-- popularity too, not just by year — tmdb_scraper.js's formatTvRecord
-- already fetches vote_average/popularity/release_date from the TMDB API
-- for every show, it just wasn't being stored.
alter table public.tv_shows
  add column if not exists release_date text,
  add column if not exists imdb_id text,
  add column if not exists vote_average numeric,
  add column if not exists popularity numeric;

create index if not exists idx_tv_shows_imdb_id
  on public.tv_shows(imdb_id);
