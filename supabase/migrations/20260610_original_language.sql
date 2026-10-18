-- Add original_language to movies and tv_shows.
-- Populated by the TMDB catalog sync — enables filtering by language
-- (e.g. Bollywood = 'hi', K-drama = 'ko', anime/J-drama = 'ja', etc.)

ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS original_language text;

ALTER TABLE public.tv_shows
  ADD COLUMN IF NOT EXISTS original_language text;

CREATE INDEX IF NOT EXISTS idx_movies_original_language
  ON public.movies (original_language);

CREATE INDEX IF NOT EXISTS idx_tv_shows_original_language
  ON public.tv_shows (original_language);
