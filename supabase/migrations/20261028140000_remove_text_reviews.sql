-- Text reviews have been retired; preserve all numerical rating columns.
-- Apply to the Supabase database (and any PostgreSQL ratings fallback).
begin;
alter table if exists public.movie_ratings drop column if exists review;
alter table if exists public.tv_show_ratings drop column if exists review;
alter table if exists public.book_ratings drop column if exists review;
commit;
