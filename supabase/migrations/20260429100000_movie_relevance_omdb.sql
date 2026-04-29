alter table public.movies
  add column if not exists release_date text,
  add column if not exists imdb_id text,
  add column if not exists vote_average numeric,
  add column if not exists popularity numeric,
  add column if not exists rotten_tomatoes_score integer,
  add column if not exists imdb_rating numeric,
  add column if not exists metacritic_score integer,
  add column if not exists ratings_enriched_at timestamptz;

create index if not exists idx_movies_imdb_id
  on public.movies(imdb_id);

create index if not exists idx_movies_ratings_enriched_at
  on public.movies(ratings_enriched_at);
