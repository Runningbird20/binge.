-- Repeatable Supabase schema sync for the frontend-first deployment.
--
-- Safe to rerun in the Supabase SQL editor because it prefers:
-- - create or replace function
-- - create table if not exists
-- - alter table ... add column if not exists
-- - drop/create trigger
-- - drop/create policy
--
-- When you add a new column in the future:
-- 1. Add it to the CREATE TABLE definition for fresh environments.
-- 2. Add it to the ALTER TABLE ... ADD COLUMN IF NOT EXISTS block for existing environments.
-- 3. If the column should be NOT NULL, give it a default or backfill existing rows first.
--
-- For destructive changes like renames, drops, or type changes, prefer a one-off migration.

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_auth_user_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, is_admin, is_dev, bio, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'username',
      split_part(new.email, '@', 1),
      'media-fan'
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'is_admin', '')::boolean,
      lower(coalesce(new.raw_user_meta_data ->> 'user_type', '')) in ('admin', 'admins'),
      false
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'is_dev', '')::boolean,
      lower(coalesce(new.raw_user_meta_data ->> 'user_type', '')) in ('coach', 'coaches', 'developer', 'developers', 'dev'),
      false
    ),
    coalesce(new.raw_user_meta_data ->> 'bio', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    username = coalesce(public.profiles.username, excluded.username),
    is_admin = coalesce(public.profiles.is_admin, excluded.is_admin, false),
    is_dev = coalesce(public.profiles.is_dev, excluded.is_dev, false),
    bio = coalesce(public.profiles.bio, excluded.bio),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

  return new;
end;
$$;

drop trigger if exists on_auth_user_changed on auth.users;
create trigger on_auth_user_changed
after insert or update on auth.users
for each row
execute function public.handle_auth_user_changed();

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null,
  is_admin boolean not null default false,
  is_dev boolean not null default false,
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists username text,
  add column if not exists is_admin boolean not null default false,
  add column if not exists is_dev boolean not null default false,
  add column if not exists is_public boolean not null default true,
  add column if not exists bio text not null default '',
  add column if not exists avatar_url text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'user_type'
  ) then
    execute $sql$
      update public.profiles
      set
        is_admin = coalesce(is_admin, false) or lower(coalesce(user_type, '')) in ('admin', 'admins'),
        is_dev = coalesce(is_dev, false) or lower(coalesce(user_type, '')) in ('coach', 'coaches', 'developer', 'developers', 'dev')
    $sql$;
  end if;
end;
$$;

update public.profiles as p
set email = u.email
from auth.users as u
where p.id = u.id
  and p.email is null
  and u.email is not null;

update public.profiles as p
set username = coalesce(
  u.raw_user_meta_data ->> 'username',
  split_part(coalesce(p.email, u.email, ''), '@', 1),
  'media-fan'
)
from auth.users as u
where p.id = u.id
  and p.username is null;

update public.profiles
set
  is_admin = coalesce(is_admin, false),
  is_dev = coalesce(is_dev, false),
  is_public = coalesce(is_public, true),
  bio = coalesce(bio, ''),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where is_admin is null
   or is_dev is null
   or is_public is null
   or bio is null
   or created_at is null
   or updated_at is null;

alter table public.profiles
  alter column is_admin set default false,
  alter column is_admin set not null,
  alter column is_dev set default false,
  alter column is_dev set not null,
  alter column is_public set default true,
  alter column is_public set not null,
  alter column bio set default '',
  alter column created_at set default now(),
  alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_email_key'
  ) then
    alter table public.profiles
      add constraint profiles_email_key unique (email);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_username_key'
  ) then
    alter table public.profiles
      add constraint profiles_username_key unique (username);
  end if;
end;
$$;

create table if not exists public.movies (
  id bigint generated by default as identity primary key,
  title text not null,
  year integer,
  genre text,
  director text,
  writers text,
  cast_members text,
  age_rating text,
  overview text,
  synopsis text,
  poster_url text,
  source_key text,
  release_date text,
  imdb_id text,
  vote_average numeric,
  popularity numeric,
  original_language text,
  rotten_tomatoes_score integer,
  imdb_rating numeric,
  metacritic_score integer,
  ratings_enriched_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.movies
  add column if not exists title text,
  add column if not exists year integer,
  add column if not exists genre text,
  add column if not exists director text,
  add column if not exists writers text,
  add column if not exists cast_members text,
  add column if not exists age_rating text,
  add column if not exists overview text,
  add column if not exists synopsis text,
  add column if not exists poster_url text,
  add column if not exists source_key text,
  add column if not exists release_date text,
  add column if not exists imdb_id text,
  add column if not exists vote_average numeric,
  add column if not exists popularity numeric,
  add column if not exists original_language text,
  add column if not exists rotten_tomatoes_score integer,
  add column if not exists imdb_rating numeric,
  add column if not exists metacritic_score integer,
  add column if not exists ratings_enriched_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.tv_shows (
  id bigint generated by default as identity primary key,
  title text not null,
  year integer,
  genre text,
  creator text,
  writers text,
  cast_members text,
  age_rating text,
  overview text,
  synopsis text,
  poster_url text,
  seasons integer,
  source_key text,
  original_language text,
  created_at timestamptz not null default now()
);

alter table public.tv_shows
  add column if not exists title text,
  add column if not exists year integer,
  add column if not exists genre text,
  add column if not exists creator text,
  add column if not exists writers text,
  add column if not exists cast_members text,
  add column if not exists age_rating text,
  add column if not exists overview text,
  add column if not exists synopsis text,
  add column if not exists poster_url text,
  add column if not exists seasons integer,
  add column if not exists source_key text,
  add column if not exists original_language text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.books (
  id bigint generated by default as identity primary key,
  title text not null,
  author text,
  year integer,
  genre text,
  synopsis text,
  cover_url text,
  item_url text,
  source_key text,
  created_at timestamptz not null default now()
);

alter table public.books
  add column if not exists title text,
  add column if not exists author text,
  add column if not exists year integer,
  add column if not exists genre text,
  add column if not exists synopsis text,
  add column if not exists cover_url text,
  add column if not exists item_url text,
  add column if not exists source_key text,
  add column if not exists created_at timestamptz not null default now();

alter table public.books alter column id type bigint;

-- Category columns are numeric(2,1) (not integer) so a rating can be a
-- half-star value like 4.5 — the app collects one 5-star (half-star
-- precision) rating per title and writes it across every category column.
create table if not exists public.movie_ratings (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id bigint not null,
  acting numeric(2,1) not null check (acting between 1 and 5 and acting * 2 = floor(acting * 2)),
  writing numeric(2,1) not null check (writing between 1 and 5 and writing * 2 = floor(writing * 2)),
  originality numeric(2,1) not null check (originality between 1 and 5 and originality * 2 = floor(originality * 2)),
  pacing numeric(2,1) not null check (pacing between 1 and 5 and pacing * 2 = floor(pacing * 2)),
  cinematography numeric(2,1) not null check (cinematography between 1 and 5 and cinematography * 2 = floor(cinematography * 2)),
  review text,
  created_at timestamptz not null default now(),
  unique (user_id, media_id)
);

alter table public.movie_ratings
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists media_id bigint,
  add column if not exists acting numeric(2,1),
  add column if not exists writing numeric(2,1),
  add column if not exists originality numeric(2,1),
  add column if not exists pacing numeric(2,1),
  add column if not exists cinematography numeric(2,1),
  add column if not exists review text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.movie_ratings'::regclass
      and conname = 'movie_ratings_user_id_media_id_key'
  ) then
    alter table public.movie_ratings
      add constraint movie_ratings_user_id_media_id_key unique (user_id, media_id);
  end if;
end;
$$;

create table if not exists public.tv_show_ratings (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id bigint not null,
  premise numeric(2,1) not null check (premise between 1 and 5 and premise * 2 = floor(premise * 2)),
  originality numeric(2,1) not null check (originality between 1 and 5 and originality * 2 = floor(originality * 2)),
  acting numeric(2,1) not null check (acting between 1 and 5 and acting * 2 = floor(acting * 2)),
  cinematography numeric(2,1) not null check (cinematography between 1 and 5 and cinematography * 2 = floor(cinematography * 2)),
  writing numeric(2,1) not null check (writing between 1 and 5 and writing * 2 = floor(writing * 2)),
  pacing numeric(2,1) not null check (pacing between 1 and 5 and pacing * 2 = floor(pacing * 2)),
  resonance numeric(2,1) not null check (resonance between 1 and 5 and resonance * 2 = floor(resonance * 2)),
  review text,
  created_at timestamptz not null default now(),
  unique (user_id, media_id)
);

alter table public.tv_show_ratings
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists media_id bigint,
  add column if not exists premise numeric(2,1),
  add column if not exists originality numeric(2,1),
  add column if not exists acting numeric(2,1),
  add column if not exists cinematography numeric(2,1),
  add column if not exists writing numeric(2,1),
  add column if not exists pacing numeric(2,1),
  add column if not exists resonance numeric(2,1),
  add column if not exists review text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tv_show_ratings'::regclass
      and conname = 'tv_show_ratings_user_id_media_id_key'
  ) then
    alter table public.tv_show_ratings
      add constraint tv_show_ratings_user_id_media_id_key unique (user_id, media_id);
  end if;
end;
$$;

create table if not exists public.book_ratings (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id bigint not null,
  prose numeric(2,1) not null check (prose between 1 and 5 and prose * 2 = floor(prose * 2)),
  plot numeric(2,1) not null check (plot between 1 and 5 and plot * 2 = floor(plot * 2)),
  characters numeric(2,1) not null check (characters between 1 and 5 and characters * 2 = floor(characters * 2)),
  originality numeric(2,1) not null check (originality between 1 and 5 and originality * 2 = floor(originality * 2)),
  pacing numeric(2,1) not null check (pacing between 1 and 5 and pacing * 2 = floor(pacing * 2)),
  resonance numeric(2,1) not null check (resonance between 1 and 5 and resonance * 2 = floor(resonance * 2)),
  review text,
  created_at timestamptz not null default now(),
  unique (user_id, media_id)
);

alter table public.book_ratings
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists media_id bigint,
  add column if not exists prose numeric(2,1),
  add column if not exists plot numeric(2,1),
  add column if not exists characters numeric(2,1),
  add column if not exists originality numeric(2,1),
  add column if not exists pacing numeric(2,1),
  add column if not exists resonance numeric(2,1),
  add column if not exists review text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.book_ratings'::regclass
      and conname = 'book_ratings_user_id_media_id_key'
  ) then
    alter table public.book_ratings
      add constraint book_ratings_user_id_media_id_key unique (user_id, media_id);
  end if;
end;
$$;

create table if not exists public.watchlist (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv_show', 'book')),
  media_id bigint not null,
  status text not null default 'plan_to_watch' check (
    status in ('plan_to_watch', 'watching', 'watched', 'plan_to_read', 'reading', 'read')
  ),
  added_at timestamptz not null default now(),
  unique (user_id, media_type, media_id)
);

alter table public.watchlist
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists media_type text,
  add column if not exists media_id bigint,
  add column if not exists status text not null default 'plan_to_watch',
  add column if not exists current_season integer,
  add column if not exists current_episode integer,
  add column if not exists current_page integer,
  add column if not exists current_chapter text,
  add column if not exists updated_at timestamptz,
  add column if not exists added_at timestamptz not null default now();

update public.watchlist
set
  status = coalesce(status, 'plan_to_watch'),
  added_at = coalesce(added_at, now()),
  updated_at = coalesce(updated_at, added_at, now())
where status is null
   or added_at is null
   or updated_at is null;

alter table public.watchlist
  alter column status set default 'plan_to_watch',
  alter column updated_at set default now(),
  alter column added_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.watchlist'::regclass
      and conname = 'watchlist_user_id_media_type_media_id_key'
  ) then
    alter table public.watchlist
      add constraint watchlist_user_id_media_type_media_id_key
      unique (user_id, media_type, media_id);
  end if;
end;
$$;

create table if not exists public.todos (
  id bigint generated by default as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.todos
  add column if not exists name text,
  add column if not exists created_at timestamptz not null default now();

with ranked as (
  select ctid, row_number() over (partition by source_key order by id) as duplicate_rank
  from public.movies
  where source_key is not null
)
delete from public.movies as movies
using ranked
where movies.ctid = ranked.ctid
  and ranked.duplicate_rank > 1;

with ranked as (
  select ctid, row_number() over (partition by source_key order by id) as duplicate_rank
  from public.tv_shows
  where source_key is not null
)
delete from public.tv_shows as tv_shows
using ranked
where tv_shows.ctid = ranked.ctid
  and ranked.duplicate_rank > 1;

with ranked as (
  select ctid, row_number() over (partition by source_key order by id) as duplicate_rank
  from public.books
  where source_key is not null
)
delete from public.books as books
using ranked
where books.ctid = ranked.ctid
  and ranked.duplicate_rank > 1;

create unique index if not exists idx_movies_source_key_unique
  on public.movies(source_key)
  where source_key is not null;

create unique index if not exists idx_tv_shows_source_key_unique
  on public.tv_shows(source_key)
  where source_key is not null;

create unique index if not exists idx_books_source_key_unique
  on public.books(source_key)
  where source_key is not null;

create index if not exists idx_movies_source_key on public.movies(source_key);
create index if not exists idx_movies_title_lower on public.movies(lower(title));
create index if not exists idx_movies_year on public.movies(year);
create index if not exists idx_movies_genre on public.movies(genre);
create index if not exists idx_movies_imdb_id on public.movies(imdb_id);
create index if not exists idx_movies_ratings_enriched_at on public.movies(ratings_enriched_at);
create index if not exists idx_movies_title_trgm on public.movies using gin (title gin_trgm_ops);
create index if not exists idx_movies_genre_trgm on public.movies using gin (genre gin_trgm_ops);
create index if not exists idx_tv_shows_source_key on public.tv_shows(source_key);
create index if not exists idx_tv_shows_title_lower on public.tv_shows(lower(title));
create index if not exists idx_tv_shows_year on public.tv_shows(year);
create index if not exists idx_tv_shows_genre on public.tv_shows(genre);
create index if not exists idx_tv_shows_title_trgm on public.tv_shows using gin (title gin_trgm_ops);
create index if not exists idx_tv_shows_genre_trgm on public.tv_shows using gin (genre gin_trgm_ops);
create index if not exists idx_books_source_key on public.books(source_key);
create index if not exists idx_books_title_lower on public.books(lower(title));
create index if not exists idx_books_author_lower on public.books(lower(author));
create index if not exists idx_books_year on public.books(year);
create index if not exists idx_books_genre on public.books(genre);
create index if not exists idx_books_title_trgm on public.books using gin (title gin_trgm_ops);
create index if not exists idx_books_author_trgm on public.books using gin (author gin_trgm_ops);
create index if not exists idx_books_genre_trgm on public.books using gin (genre gin_trgm_ops);
create index if not exists idx_movie_ratings_user_id on public.movie_ratings(user_id);
create index if not exists idx_tv_show_ratings_user_id on public.tv_show_ratings(user_id);
create index if not exists idx_book_ratings_user_id on public.book_ratings(user_id);
create index if not exists idx_watchlist_user_id on public.watchlist(user_id);
create index if not exists idx_watchlist_user_media on public.watchlist(user_id, media_type, status);

create or replace view public.movie_genres as
select distinct trim(split_genre.genre_value) as genre
from public.movies
cross join lateral regexp_split_to_table(coalesce(public.movies.genre, ''), ',') as split_genre(genre_value)
where trim(split_genre.genre_value) <> '';

create or replace view public.tv_show_genres as
select distinct trim(split_genre.genre_value) as genre
from public.tv_shows
cross join lateral regexp_split_to_table(coalesce(public.tv_shows.genre, ''), ',') as split_genre(genre_value)
where trim(split_genre.genre_value) <> '';

create or replace view public.book_genres as
select distinct trim(split_genre.genre_value) as genre
from public.books
cross join lateral regexp_split_to_table(coalesce(public.books.genre, ''), ',') as split_genre(genre_value)
where trim(split_genre.genre_value) <> '';

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_watchlist_set_updated_at on public.watchlist;
create trigger trg_watchlist_set_updated_at
before update on public.watchlist
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
create table if not exists public.follows (
  id bigint generated by default as identity primary key,
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id)
);

alter table public.follows
  add column if not exists follower_id uuid references auth.users(id) on delete cascade,
  add column if not exists following_id uuid references auth.users(id) on delete cascade,
  add column if not exists created_at timestamptz not null default now();

update public.follows
set created_at = coalesce(created_at, now())
where created_at is null;

alter table public.follows enable row level security;
alter table public.follows
  alter column created_at set default now();

alter table public.movies enable row level security;
alter table public.tv_shows enable row level security;
alter table public.books enable row level security;
alter table public.movie_ratings enable row level security;
alter table public.tv_show_ratings enable row level security;
alter table public.book_ratings enable row level security;
alter table public.watchlist enable row level security;
alter table public.todos enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "movies_public_read" on public.movies;
create policy "movies_public_read"
on public.movies
for select
using (true);

grant select on public.movie_genres to anon, authenticated;
grant select on public.tv_show_genres to anon, authenticated;
grant select on public.book_genres to anon, authenticated;

drop policy if exists "tv_public_read" on public.tv_shows;
create policy "tv_public_read"
on public.tv_shows
for select
using (true);

drop policy if exists "books_public_read" on public.books;
create policy "books_public_read"
on public.books
for select
using (true);

drop policy if exists "movie_ratings_select_own" on public.movie_ratings;
create policy "movie_ratings_select_own"
on public.movie_ratings
for select
to authenticated
using (
  auth.uid() = user_id
  or user_id in (
    select following_id
    from public.follows
    where follower_id = auth.uid()
  )
);

drop policy if exists "movie_ratings_insert_own" on public.movie_ratings;
create policy "movie_ratings_insert_own"
on public.movie_ratings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "movie_ratings_update_own" on public.movie_ratings;
create policy "movie_ratings_update_own"
on public.movie_ratings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "movie_ratings_delete_own" on public.movie_ratings;
create policy "movie_ratings_delete_own"
on public.movie_ratings
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "tv_show_ratings_select_own" on public.tv_show_ratings;
create policy "tv_show_ratings_select_own"
on public.tv_show_ratings
for select
to authenticated
using (
  auth.uid() = user_id
  or user_id in (
    select following_id
    from public.follows
    where follower_id = auth.uid()
  )
);

drop policy if exists "tv_show_ratings_insert_own" on public.tv_show_ratings;
create policy "tv_show_ratings_insert_own"
on public.tv_show_ratings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "tv_show_ratings_update_own" on public.tv_show_ratings;
create policy "tv_show_ratings_update_own"
on public.tv_show_ratings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "tv_show_ratings_delete_own" on public.tv_show_ratings;
create policy "tv_show_ratings_delete_own"
on public.tv_show_ratings
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "book_ratings_select_own" on public.book_ratings;
create policy "book_ratings_select_own"
on public.book_ratings
for select
to authenticated
using (
  auth.uid() = user_id
  or user_id in (
    select following_id
    from public.follows
    where follower_id = auth.uid()
  )
);

drop policy if exists "book_ratings_insert_own" on public.book_ratings;
create policy "book_ratings_insert_own"
on public.book_ratings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "book_ratings_update_own" on public.book_ratings;
create policy "book_ratings_update_own"
on public.book_ratings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "book_ratings_delete_own" on public.book_ratings;
create policy "book_ratings_delete_own"
on public.book_ratings
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "watchlist_select_own" on public.watchlist;
create policy "watchlist_select_own"
on public.watchlist
for select
to authenticated
using (
  auth.uid() = user_id
  or user_id in (
    select following_id
    from public.follows
    where follower_id = auth.uid()
  )
);

drop policy if exists "watchlist_insert_own" on public.watchlist;
create policy "watchlist_insert_own"
on public.watchlist
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "watchlist_update_own" on public.watchlist;
create policy "watchlist_update_own"
on public.watchlist
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "watchlist_delete_own" on public.watchlist;
create policy "watchlist_delete_own"
on public.watchlist
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "follows_select_own" on public.follows;
create policy "follows_select_own"
on public.follows
for select
to authenticated
using (
  auth.uid() = follower_id
  or auth.uid() = following_id
);

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
on public.follows
for insert
to authenticated
with check (
  auth.uid() = follower_id
  and auth.uid() != following_id
);

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own"
on public.follows
for delete
to authenticated
using (auth.uid() = follower_id);

drop policy if exists "todos_public_read" on public.todos;
create policy "todos_public_read"
on public.todos
for select
using (true);

create table if not exists public.chatbot_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_type text not null,
  media_type text,
  source_url text,
  source_label text,
  tags text[] not null default '{}',
  content text not null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chatbot_knowledge_documents_title
  on public.chatbot_knowledge_documents (lower(title));

create index if not exists idx_chatbot_knowledge_documents_source_type
  on public.chatbot_knowledge_documents (source_type);

create index if not exists idx_chatbot_knowledge_documents_tags
  on public.chatbot_knowledge_documents using gin (tags);

drop trigger if exists set_chatbot_knowledge_documents_updated_at on public.chatbot_knowledge_documents;
create trigger set_chatbot_knowledge_documents_updated_at
before update on public.chatbot_knowledge_documents
for each row
execute function public.set_updated_at();

create table if not exists public.chatbot_prompt_profiles (
  intent text primary key,
  label text not null,
  description text,
  system_prompt text not null,
  temperature numeric not null default 0.4,
  max_titles integer not null default 5,
  updated_at timestamptz not null default now()
);

create table if not exists public.chatbot_eval_cases (
  id bigserial primary key,
  label text not null,
  question text not null,
  expected_intent text,
  expected_phrases text[] not null default '{}',
  forbidden_phrases text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_chatbot_eval_cases_updated_at on public.chatbot_eval_cases;
create trigger set_chatbot_eval_cases_updated_at
before update on public.chatbot_eval_cases
for each row
execute function public.set_updated_at();

create table if not exists public.chatbot_eval_runs (
  id bigserial primary key,
  case_id bigint references public.chatbot_eval_cases(id) on delete set null,
  label text,
  question text not null,
  selected_intent text,
  intent_match boolean not null default false,
  passed boolean not null default false,
  expected_hits text[] not null default '{}',
  missing_expected text[] not null default '{}',
  forbidden_hits text[] not null default '{}',
  response_text text,
  system_prompt text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_chatbot_eval_runs_created_at
  on public.chatbot_eval_runs (created_at desc);

insert into public.chatbot_prompt_profiles (
  intent,
  label,
  description,
  system_prompt,
  temperature,
  max_titles
)
values
  (
    'general',
    'General',
    'Balanced everyday assistant behavior for broad questions.',
    'Answer in a warm, natural voice. Prefer short paragraphs, stay grounded in the provided catalog and knowledge base, and do not use markdown bullets unless the user asks for a list.',
    0.45,
    5
  ),
  (
    'factual',
    'Factual Lookup',
    'Direct answers for cast, release, runtime, and title lookups.',
    'Answer directly and accurately. Lead with the answer, keep the wording compact, and only mention supporting context that helps the user verify the fact.',
    0.2,
    3
  ),
  (
    'thematic',
    'Explanation',
    'Interpretive answers about themes, comparisons, and analysis.',
    'Explain ideas clearly and conversationally. Focus on meaning, themes, and comparisons, and connect the answer back to the user question instead of sounding academic.',
    0.4,
    4
  ),
  (
    'recommendation',
    'Recommendation',
    'Recommendation mode for shortlist-style answers.',
    'Recommend only the strongest matches. Keep the answer human and specific, mention why each suggestion fits, and avoid dumping a long catalog.',
    0.55,
    5
  ),
  (
    'creative',
    'Creative',
    'Creative responses such as pitches, rewrites, and alternate versions.',
    'Be imaginative while still respecting the supplied context. Use an engaging voice, but keep the output readable and avoid heavy markdown formatting.',
    0.75,
    4
  )
on conflict (intent) do nothing;

-- ─── Sub-profiles (Netflix-style multiple profiles per account) ────────────
-- Deliberately NOT a new security boundary: every profile under an account
-- is visible to that account's own authenticated session (same as real
-- Netflix — a kid profile isn't a separate login). So existing RLS policies
-- on watchlist/ratings/continue_watching/episode_progress, all keyed on
-- `user_id = auth.uid()`, are untouched. profile_id is purely an app-level
-- scoping column the client always filters/sets, not an RLS concern.
create table if not exists public.account_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  avatar_url text,
  is_kids boolean not null default false,
  is_default boolean not null default false,
  pin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one default profile per account — the profile new data backfills
-- onto and the one auto-selected on first login after this migration.
create unique index if not exists idx_account_profiles_one_default
  on public.account_profiles(account_id)
  where is_default;

create index if not exists idx_account_profiles_account_id
  on public.account_profiles(account_id);

-- User-picked swatch for the avatar background, independent of the emoji
-- choice (previously derived purely from a hash of the profile id).
alter table public.account_profiles add column if not exists avatar_color text;

drop trigger if exists trg_account_profiles_set_updated_at on public.account_profiles;
create trigger trg_account_profiles_set_updated_at
before update on public.account_profiles
for each row execute function public.set_updated_at();

alter table public.account_profiles enable row level security;

drop policy if exists "account_profiles_select_own" on public.account_profiles;
create policy "account_profiles_select_own"
on public.account_profiles
for select
to authenticated
using (account_id = auth.uid());

drop policy if exists "account_profiles_insert_own" on public.account_profiles;
create policy "account_profiles_insert_own"
on public.account_profiles
for insert
to authenticated
with check (account_id = auth.uid());

drop policy if exists "account_profiles_update_own" on public.account_profiles;
create policy "account_profiles_update_own"
on public.account_profiles
for update
to authenticated
using (account_id = auth.uid())
with check (account_id = auth.uid());

drop policy if exists "account_profiles_delete_own" on public.account_profiles;
create policy "account_profiles_delete_own"
on public.account_profiles
for delete
to authenticated
using (account_id = auth.uid());

-- New accounts get a default profile automatically. Separate trigger from
-- handle_auth_user_changed (which owns public.profiles) so this doesn't
-- touch that existing, already-load-bearing trigger.
create or replace function public.handle_auth_user_account_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The default profile is the account itself — it uses whatever picture
  -- was set at signup (raw_user_meta_data, same source public.profiles
  -- reads), not a separate emoji avatar like sub-profiles get.
  insert into public.account_profiles (account_id, name, avatar_url, is_default)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1), 'Profile 1'),
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    true
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_account_profile on auth.users;
create trigger trg_auth_user_account_profile
after insert on auth.users
for each row execute function public.handle_auth_user_account_profile();

-- profile_id on every per-user data table it's meaningful for. Nullable —
-- the backfill below fills it in for all existing rows, but keeping it
-- nullable at the schema level avoids a NOT NULL constraint blocking this
-- migration if a future edge case row somehow doesn't get backfilled.
alter table public.watchlist add column if not exists profile_id uuid references public.account_profiles(id) on delete cascade;
alter table public.movie_ratings add column if not exists profile_id uuid references public.account_profiles(id) on delete cascade;
alter table public.tv_show_ratings add column if not exists profile_id uuid references public.account_profiles(id) on delete cascade;
alter table public.book_ratings add column if not exists profile_id uuid references public.account_profiles(id) on delete cascade;
alter table public.continue_watching add column if not exists profile_id uuid references public.account_profiles(id) on delete cascade;
alter table public.episode_progress add column if not exists profile_id uuid references public.account_profiles(id) on delete cascade;

create index if not exists idx_watchlist_profile_id on public.watchlist(profile_id);
create index if not exists idx_movie_ratings_profile_id on public.movie_ratings(profile_id);
create index if not exists idx_tv_show_ratings_profile_id on public.tv_show_ratings(profile_id);
create index if not exists idx_book_ratings_profile_id on public.book_ratings(profile_id);
create index if not exists idx_continue_watching_profile_id on public.continue_watching(profile_id);
create index if not exists idx_episode_progress_profile_id on public.episode_progress(profile_id);

-- Backfill: give every existing account a default profile, then stamp all
-- of that account's existing rows with it. Idempotent — safe to rerun.
insert into public.account_profiles (account_id, name, avatar_url, is_default)
select
  u.id,
  coalesce(nullif(p.username, ''), split_part(u.email, '@', 1), 'Profile 1'),
  p.avatar_url,
  true
from auth.users u
left join public.profiles p on p.id = u.id
where not exists (
  select 1 from public.account_profiles ap where ap.account_id = u.id and ap.is_default
);

-- Existing default profiles created before this column was backfilled above
-- (i.e. by an earlier run of this same migration) still need to pick up the
-- account's real avatar.
update public.account_profiles ap
set avatar_url = p.avatar_url
from public.profiles p
where ap.is_default and ap.avatar_url is null and p.id = ap.account_id and p.avatar_url is not null;

update public.watchlist w
set profile_id = ap.id
from public.account_profiles ap
where w.profile_id is null and ap.account_id = w.user_id and ap.is_default;

update public.movie_ratings r
set profile_id = ap.id
from public.account_profiles ap
where r.profile_id is null and ap.account_id = r.user_id and ap.is_default;

update public.tv_show_ratings r
set profile_id = ap.id
from public.account_profiles ap
where r.profile_id is null and ap.account_id = r.user_id and ap.is_default;

update public.book_ratings r
set profile_id = ap.id
from public.account_profiles ap
where r.profile_id is null and ap.account_id = r.user_id and ap.is_default;

update public.continue_watching c
set profile_id = ap.id
from public.account_profiles ap
where c.profile_id is null and ap.account_id = c.user_id and ap.is_default;

update public.episode_progress e
set profile_id = ap.id
from public.account_profiles ap
where e.profile_id is null and ap.account_id = e.user_id and ap.is_default;

-- watchlist's uniqueness was (user_id, media_type, media_id) — pre-dates
-- profiles, so it would block two different profiles on the same account
-- from independently saving the same title. Widen it to include profile_id
-- now that every row has one.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.watchlist'::regclass
      and conname = 'watchlist_user_id_media_type_media_id_key'
  ) then
    alter table public.watchlist
      drop constraint watchlist_user_id_media_type_media_id_key;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.watchlist'::regclass
      and conname = 'watchlist_user_media_profile_key'
  ) then
    alter table public.watchlist
      add constraint watchlist_user_media_profile_key
      unique (user_id, media_type, media_id, profile_id);
  end if;
end;
$$;

-- Same widening for continue_watching (its onConflict upsert target) and
-- episode_progress, so per-profile progress doesn't collide across profiles
-- on the same account.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.continue_watching'::regclass
      and conname = 'continue_watching_unique'
  ) then
    alter table public.continue_watching
      drop constraint continue_watching_unique;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.continue_watching'::regclass
      and conname = 'continue_watching_user_media_profile_key'
  ) then
    alter table public.continue_watching
      add constraint continue_watching_user_media_profile_key
      unique (user_id, media_type, media_id, profile_id);
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.episode_progress'::regclass
      and conname = 'episode_progress_unique'
  ) then
    alter table public.episode_progress
      drop constraint episode_progress_unique;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.episode_progress'::regclass
      and conname = 'episode_progress_user_media_profile_key'
  ) then
    alter table public.episode_progress
      add constraint episode_progress_user_media_profile_key
      unique (user_id, media_id, season, episode, profile_id);
  end if;
end;
$$;

-- Same widening for the three per-type rating tables (their upsert target
-- is user_id+media_id — one rating per title per user — which should be one
-- rating per title per PROFILE now).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.movie_ratings'::regclass
      and conname = 'movie_ratings_user_id_media_id_key'
  ) then
    alter table public.movie_ratings
      drop constraint movie_ratings_user_id_media_id_key;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.movie_ratings'::regclass
      and conname = 'movie_ratings_user_media_profile_key'
  ) then
    alter table public.movie_ratings
      add constraint movie_ratings_user_media_profile_key
      unique (user_id, media_id, profile_id);
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.tv_show_ratings'::regclass
      and conname = 'tv_show_ratings_user_id_media_id_key'
  ) then
    alter table public.tv_show_ratings
      drop constraint tv_show_ratings_user_id_media_id_key;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tv_show_ratings'::regclass
      and conname = 'tv_show_ratings_user_media_profile_key'
  ) then
    alter table public.tv_show_ratings
      add constraint tv_show_ratings_user_media_profile_key
      unique (user_id, media_id, profile_id);
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.book_ratings'::regclass
      and conname = 'book_ratings_user_id_media_id_key'
  ) then
    alter table public.book_ratings
      drop constraint book_ratings_user_id_media_id_key;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.book_ratings'::regclass
      and conname = 'book_ratings_user_media_profile_key'
  ) then
    alter table public.book_ratings
      add constraint book_ratings_user_media_profile_key
      unique (user_id, media_id, profile_id);
  end if;
end;
$$;

-- ─── Search performance: trigram indexes ────────────────────────────────
-- Backs the "related" search tier's overview/synopsis ILIKE matching
-- (previously an unindexed full-table scan taking 10+ seconds). pg_trgm is
-- already enabled above.
create index if not exists idx_movies_overview_trgm on public.movies using gin (overview gin_trgm_ops);
create index if not exists idx_movies_synopsis_trgm on public.movies using gin (synopsis gin_trgm_ops);
create index if not exists idx_tv_shows_overview_trgm on public.tv_shows using gin (overview gin_trgm_ops);
create index if not exists idx_tv_shows_synopsis_trgm on public.tv_shows using gin (synopsis gin_trgm_ops);
create index if not exists idx_books_synopsis_trgm on public.books using gin (synopsis gin_trgm_ops);

-- Backs the kids-profile content filter (age_rating IN (...)) combined with
-- the browse page's sort column. Partial indexes, not a plain/composite
-- age_rating index: an IN-list over 6 values needs Postgres to either sort
-- ~6k matching rows after the fact or merge-append 6 separate index ranges,
-- both of which cost 1s+ even warm (PostgREST's statement_timeout is well
-- under that, so the query 500'd and the app silently fell back to the
-- unfiltered offline snapshot — the actual bug behind kids mode showing
-- unfiltered content). A partial index scoped to exactly this rating set
-- returns already sorted, dropping this to ~1ms.
drop index if exists idx_movies_age_rating;
drop index if exists idx_movies_age_rating_title;
drop index if exists idx_movies_age_rating_year;
drop index if exists idx_tv_shows_age_rating;
drop index if exists idx_tv_shows_age_rating_title;
drop index if exists idx_tv_shows_age_rating_year;
create index if not exists idx_movies_kids_title on public.movies (title) where age_rating in ('G','PG','TV-G','TV-Y','TV-Y7','TV-PG');
create index if not exists idx_movies_kids_year on public.movies (year) where age_rating in ('G','PG','TV-G','TV-Y','TV-Y7','TV-PG');
create index if not exists idx_tv_shows_kids_title on public.tv_shows (title) where age_rating in ('G','PG','TV-G','TV-Y','TV-Y7','TV-PG');
create index if not exists idx_tv_shows_kids_year on public.tv_shows (year) where age_rating in ('G','PG','TV-G','TV-Y','TV-Y7','TV-PG');

commit;
