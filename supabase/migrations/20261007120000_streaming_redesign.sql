-- Streaming-service redesign: everything the new Home/Movies/TV rows,
-- recommendations, search and the player's audio/subtitle server picker
-- need from the database. Purely additive apart from re-creating the three
-- collaborative_*_candidates functions (see section 2).

-- ── 1. Popularity / language indexes ────────────────────────────────────
-- Browse rows sort by popularity. Without these, an ORDER BY popularity
-- over 160k movies / 70k shows took 1.5–6s (measured), close to the
-- authenticated role's 8s statement_timeout once a genre filter is added.
-- Partial on poster_url since rows never show poster-less titles.
create index if not exists idx_movies_popularity_poster
  on public.movies (popularity desc nulls last)
  where poster_url is not null;

create index if not exists idx_tv_shows_popularity_poster
  on public.tv_shows (popularity desc nulls last)
  where poster_url is not null;

create index if not exists idx_movies_lang_popularity
  on public.movies (original_language, popularity desc nulls last)
  where poster_url is not null;

create index if not exists idx_tv_shows_lang_popularity
  on public.tv_shows (original_language, popularity desc nulls last)
  where poster_url is not null;

create index if not exists idx_movies_release_date
  on public.movies (release_date)
  where poster_url is not null;

-- ── 2. Collaborative filtering: only ever for the caller ───────────────
-- The previous versions took p_user_id as an argument and were security
-- definer, so any signed-in user could pass someone else's id and learn
-- what that person liked. The caller's id now always comes from
-- auth.uid(); the argument is kept (ignored) so existing callers work.
create or replace function public.collaborative_movie_candidates(
  p_user_id uuid,
  p_profile_id uuid,
  p_limit integer default 30
)
returns table (media_id bigint, affinity numeric)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  my_likes as (
    select mr.media_id
    from public.movie_ratings mr, me
    where mr.user_id = me.uid
      and mr.profile_id is not distinct from p_profile_id
      and (mr.acting + mr.writing + mr.originality + mr.pacing + mr.cinematography) / 5.0 >= 4.0
    union
    select w.media_id
    from public.watchlist w, me
    where w.user_id = me.uid
      and w.profile_id is not distinct from p_profile_id
      and w.media_type = 'movie'
      and w.status = 'watched'
  ),
  neighbors as (
    select mr.user_id, mr.profile_id, count(*) as overlap
    from public.movie_ratings mr
    join my_likes ml on ml.media_id = mr.media_id
    cross join me
    where (mr.acting + mr.writing + mr.originality + mr.pacing + mr.cinematography) / 5.0 >= 4.0
      and not (mr.user_id = me.uid and mr.profile_id is not distinct from p_profile_id)
    group by mr.user_id, mr.profile_id
    order by count(*) desc
    limit 200
  ),
  neighbor_likes as (
    select mr.media_id, n.overlap
    from public.movie_ratings mr
    join neighbors n on n.user_id = mr.user_id and n.profile_id is not distinct from mr.profile_id
    where (mr.acting + mr.writing + mr.originality + mr.pacing + mr.cinematography) / 5.0 >= 4.0
    union all
    select w.media_id, n.overlap
    from public.watchlist w
    join neighbors n on n.user_id = w.user_id and n.profile_id is not distinct from w.profile_id
    where w.media_type = 'movie' and w.status = 'watched'
  )
  select nl.media_id, sum(nl.overlap)::numeric as affinity
  from neighbor_likes nl
  where (select uid from me) is not null
    and nl.media_id not in (select media_id from my_likes)
  group by nl.media_id
  order by affinity desc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.collaborative_tv_candidates(
  p_user_id uuid,
  p_profile_id uuid,
  p_limit integer default 30
)
returns table (media_id bigint, affinity numeric)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  my_likes as (
    select tr.media_id
    from public.tv_show_ratings tr, me
    where tr.user_id = me.uid
      and tr.profile_id is not distinct from p_profile_id
      and (tr.premise + tr.originality + tr.acting + tr.cinematography + tr.writing + tr.pacing + tr.resonance) / 7.0 >= 4.0
    union
    select w.media_id
    from public.watchlist w, me
    where w.user_id = me.uid
      and w.profile_id is not distinct from p_profile_id
      and w.media_type = 'tv_show'
      and w.status = 'watched'
  ),
  neighbors as (
    select tr.user_id, tr.profile_id, count(*) as overlap
    from public.tv_show_ratings tr
    join my_likes ml on ml.media_id = tr.media_id
    cross join me
    where (tr.premise + tr.originality + tr.acting + tr.cinematography + tr.writing + tr.pacing + tr.resonance) / 7.0 >= 4.0
      and not (tr.user_id = me.uid and tr.profile_id is not distinct from p_profile_id)
    group by tr.user_id, tr.profile_id
    order by count(*) desc
    limit 200
  ),
  neighbor_likes as (
    select tr.media_id, n.overlap
    from public.tv_show_ratings tr
    join neighbors n on n.user_id = tr.user_id and n.profile_id is not distinct from tr.profile_id
    where (tr.premise + tr.originality + tr.acting + tr.cinematography + tr.writing + tr.pacing + tr.resonance) / 7.0 >= 4.0
    union all
    select w.media_id, n.overlap
    from public.watchlist w
    join neighbors n on n.user_id = w.user_id and n.profile_id is not distinct from w.profile_id
    where w.media_type = 'tv_show' and w.status = 'watched'
  )
  select nl.media_id, sum(nl.overlap)::numeric as affinity
  from neighbor_likes nl
  where (select uid from me) is not null
    and nl.media_id not in (select media_id from my_likes)
  group by nl.media_id
  order by affinity desc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.collaborative_book_candidates(
  p_user_id uuid,
  p_profile_id uuid,
  p_limit integer default 30
)
returns table (media_id bigint, affinity numeric)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  my_likes as (
    select br.media_id
    from public.book_ratings br, me
    where br.user_id = me.uid
      and br.profile_id is not distinct from p_profile_id
      and (br.prose + br.plot + br.characters + br.originality + br.pacing + br.resonance) / 6.0 >= 4.0
    union
    select w.media_id
    from public.watchlist w, me
    where w.user_id = me.uid
      and w.profile_id is not distinct from p_profile_id
      and w.media_type = 'book'
      and w.status = 'read'
  ),
  neighbors as (
    select br.user_id, br.profile_id, count(*) as overlap
    from public.book_ratings br
    join my_likes ml on ml.media_id = br.media_id
    cross join me
    where (br.prose + br.plot + br.characters + br.originality + br.pacing + br.resonance) / 6.0 >= 4.0
      and not (br.user_id = me.uid and br.profile_id is not distinct from p_profile_id)
    group by br.user_id, br.profile_id
    order by count(*) desc
    limit 200
  ),
  neighbor_likes as (
    select br.media_id, n.overlap
    from public.book_ratings br
    join neighbors n on n.user_id = br.user_id and n.profile_id is not distinct from br.profile_id
    where (br.prose + br.plot + br.characters + br.originality + br.pacing + br.resonance) / 6.0 >= 4.0
    union all
    select w.media_id, n.overlap
    from public.watchlist w
    join neighbors n on n.user_id = w.user_id and n.profile_id is not distinct from w.profile_id
    where w.media_type = 'book' and w.status = 'read'
  )
  select nl.media_id, sum(nl.overlap)::numeric as affinity
  from neighbor_likes nl
  where (select uid from me) is not null
    and nl.media_id not in (select media_id from my_likes)
  group by nl.media_id
  order by affinity desc
  limit least(greatest(p_limit, 1), 100);
$$;

revoke execute on function public.collaborative_movie_candidates(uuid, uuid, integer) from public, anon;
revoke execute on function public.collaborative_tv_candidates(uuid, uuid, integer) from public, anon;
revoke execute on function public.collaborative_book_candidates(uuid, uuid, integer) from public, anon;
grant execute on function public.collaborative_movie_candidates(uuid, uuid, integer) to authenticated;
grant execute on function public.collaborative_tv_candidates(uuid, uuid, integer) to authenticated;
grant execute on function public.collaborative_book_candidates(uuid, uuid, integer) to authenticated;

-- ── 3. Ranked catalog search ────────────────────────────────────────────
-- Replaces the Express route's SQLite snapshot search (8 results, newest
-- first, not the live catalog). Ranks by title similarity with a bonus for
-- exact/prefix matches and a log-scaled popularity tiebreak, and drops
-- titles releasing more than 30 days from now. Uses the existing
-- idx_*_title_trgm GIN indexes via the % operator.
-- Calling a pg_trgm function loads the extension's library, which
-- registers pg_trgm.similarity_threshold as a normal user-settable
-- parameter; without it, the function-level SET below is rejected with
-- "permission denied to set parameter".
select public.similarity('binge', 'binge');

create or replace function public.search_catalog(q text, lim integer default 24)
returns table (
  result_type text,
  id bigint,
  title text,
  year integer,
  genre text,
  poster_url text,
  author text,
  source_key text,
  release_date text,
  original_language text,
  popularity numeric,
  vote_average numeric,
  score real
)
language plpgsql
stable
set search_path = public
-- Default 0.3 lets a query like "the office" pull in tens of thousands of
-- trigram candidates via the common word "the" (measured: 15s). Typo
-- tolerance at 0.45 still catches "squid gme" -> Squid Game.
set pg_trgm.similarity_threshold = '0.45'
as $$
declare
  term text := lower(trim(coalesce(q, '')));
  prefix text;
  n integer := least(greatest(coalesce(lim, 24), 1), 60);
  cutoff text := (current_date + 30)::text;
  max_year integer := extract(year from current_date)::int;
begin
  if char_length(term) < 2 then
    return;
  end if;
  -- Escape LIKE wildcards in the user's text before building the prefix.
  prefix := replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Both predicates (trigram % and ILIKE prefix) are served by the
  -- idx_*_title_trgm GIN indexes; the term is a plain variable here so the
  -- planner sees a constant and can use them.
  return query
  (select 'movie'::text, m.id, m.title, m.year, m.genre, m.poster_url, null::text,
          m.source_key, m.release_date, m.original_language, m.popularity, m.vote_average,
          (similarity(m.title, term)
            + case when lower(m.title) = term then 1.0
                   when m.title ilike prefix then 0.45
                   else 0 end
            + ln(1 + coalesce(m.popularity, 0)) * 0.06)::real
   from public.movies m
   where (m.title % term or m.title ilike prefix)
     and m.source_key is not null
     and coalesce(m.release_date, '0000') <= cutoff
     and coalesce(m.year, 0) <= max_year + 1
   order by 13 desc
   limit n)
  union all
  (select 'tv'::text, t.id, t.title, t.year, t.genre, t.poster_url, null::text,
          t.source_key, t.release_date, t.original_language, t.popularity, t.vote_average,
          (similarity(t.title, term)
            + case when lower(t.title) = term then 1.0
                   when t.title ilike prefix then 0.45
                   else 0 end
            + ln(1 + coalesce(t.popularity, 0)) * 0.06)::real
   from public.tv_shows t
   where (t.title % term or t.title ilike prefix)
     and t.source_key is not null
     and coalesce(t.year, 0) <= max_year
   order by 13 desc
   limit n)
  union all
  (select 'book'::text, b.id, b.title, b.year, b.genre, b.cover_url, b.author,
          b.source_key, null::text, null::text, null::numeric, null::numeric,
          (similarity(b.title, term)
            + case when lower(b.title) = term then 1.0
                   when b.title ilike prefix then 0.45
                   else 0 end)::real
   from public.books b
   where (b.title % term or b.title ilike prefix)
     and b.source_key is not null
   order by 13 desc
   limit n);
end;
$$;

grant execute on function public.search_catalog(text, integer) to anon, authenticated;

-- ── 4. Server (embed provider) reports ──────────────────────────────────
-- Third-party embed players are cross-origin iframes: the app cannot see
-- which audio track or subtitle languages a server actually serves, or
-- whether it plays at all. Viewers report it from the player's "Audio &
-- Subtitles" panel instead, and the player ranks servers per title from
-- these reports (plus the viewer's own last-working server).
create table if not exists public.stream_reports (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv_show')),
  media_id bigint not null,
  provider text not null check (char_length(provider) <= 40),
  works boolean not null,
  audio_lang text check (audio_lang is null or audio_lang ~ '^[a-z]{2,3}$'),
  has_subs boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, media_type, media_id, provider)
);

create index if not exists idx_stream_reports_media
  on public.stream_reports (media_type, media_id);

alter table public.stream_reports enable row level security;

drop policy if exists stream_reports_select_own on public.stream_reports;
create policy stream_reports_select_own on public.stream_reports
  for select using (user_id = auth.uid());

drop policy if exists stream_reports_insert_own on public.stream_reports;
create policy stream_reports_insert_own on public.stream_reports
  for insert with check (user_id = auth.uid());

drop policy if exists stream_reports_update_own on public.stream_reports;
create policy stream_reports_update_own on public.stream_reports
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists stream_reports_delete_own on public.stream_reports;
create policy stream_reports_delete_own on public.stream_reports
  for delete using (user_id = auth.uid());

-- Aggregated per-provider summary for one title. Security definer so it
-- can count everyone's reports, but it only returns counts — never who
-- reported what.
create or replace function public.stream_report_summary(p_media_type text, p_media_id bigint)
returns table (
  provider text,
  works_count bigint,
  broken_count bigint,
  audio_lang text,
  audio_count bigint,
  subs_count bigint,
  last_report timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.provider,
         count(*) filter (where r.works) as works_count,
         count(*) filter (where not r.works) as broken_count,
         mode() within group (order by r.audio_lang) filter (where r.works and r.audio_lang is not null) as audio_lang,
         count(*) filter (where r.works and r.audio_lang is not null) as audio_count,
         count(*) filter (where r.works and r.has_subs) as subs_count,
         max(r.updated_at) as last_report
  from public.stream_reports r
  where r.media_type = p_media_type
    and r.media_id = p_media_id
    and r.updated_at > now() - interval '120 days'
  group by r.provider;
$$;

revoke execute on function public.stream_report_summary(text, bigint) from public, anon;
grant execute on function public.stream_report_summary(text, bigint) to authenticated;

-- ── 5. Per-profile playback language preferences ───────────────────────
alter table public.account_profiles
  add column if not exists audio_pref text,
  add column if not exists subtitle_pref text;
