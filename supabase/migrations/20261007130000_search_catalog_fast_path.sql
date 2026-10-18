-- search_catalog, two-pass. Measured on the live catalog: the trigram
-- similarity (%) predicate rechecks ~10.5k movie rows for "the office"
-- (common word "the"), ~1.4s cold — past the anon role's 3s limit once
-- tv_shows and books are added. The exact/prefix/contains ILIKE pass uses
-- the same GIN index precisely (14 candidates, ~4ms). So: run the ILIKE
-- pass first, and only fall back to the fuzzy pass (typo tolerance,
-- "squid gme" -> Squid Game) when it finds too little.

-- Loads pg_trgm's library so the function-level SET below is accepted.
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
set pg_trgm.similarity_threshold = '0.45'
as $$
declare
  term text := lower(trim(coalesce(q, '')));
  escaped text;
  prefix text;
  contains text;
  n integer := least(greatest(coalesce(lim, 24), 1), 60);
  cutoff text := (current_date + 30)::text;
  max_year integer := extract(year from current_date)::int;
  found_rows integer := 0;
  batch integer;
begin
  if char_length(term) < 2 then
    return;
  end if;

  escaped := replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_');
  prefix := escaped || '%';
  -- Substring match only for 4+ characters: "the"/"of" as a substring
  -- would match most of the catalog.
  contains := case when char_length(term) >= 4 then '%' || escaped || '%' else prefix end;

  -- Pass 1: exact / prefix / substring (index-precise).
  return query
  (select 'movie'::text, m.id, m.title, m.year, m.genre, m.poster_url, null::text,
          m.source_key, m.release_date, m.original_language, m.popularity, m.vote_average,
          (similarity(m.title, term)
            + case when lower(m.title) = term then 1.0
                   when m.title ilike prefix then 0.45
                   else 0.15 end
            + ln(1 + coalesce(m.popularity, 0)) * 0.06)::real
   from public.movies m
   where m.title ilike contains
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
                   else 0.15 end
            + ln(1 + coalesce(t.popularity, 0)) * 0.06)::real
   from public.tv_shows t
   where t.title ilike contains
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
                   else 0.15 end)::real
   from public.books b
   where (b.title ilike contains or b.author ilike contains)
     and b.source_key is not null
   order by 13 desc
   limit n);

  get diagnostics batch = row_count;
  found_rows := batch;

  if found_rows >= 6 then
    return;
  end if;

  -- Pass 2: fuzzy (typos). May repeat a pass-1 row; the client keeps the
  -- highest score per id.
  return query
  (select 'movie'::text, m.id, m.title, m.year, m.genre, m.poster_url, null::text,
          m.source_key, m.release_date, m.original_language, m.popularity, m.vote_average,
          (similarity(m.title, term) + ln(1 + coalesce(m.popularity, 0)) * 0.06)::real
   from public.movies m
   where m.title % term
     and m.source_key is not null
     and coalesce(m.release_date, '0000') <= cutoff
     and coalesce(m.year, 0) <= max_year + 1
   order by 13 desc
   limit n)
  union all
  (select 'tv'::text, t.id, t.title, t.year, t.genre, t.poster_url, null::text,
          t.source_key, t.release_date, t.original_language, t.popularity, t.vote_average,
          (similarity(t.title, term) + ln(1 + coalesce(t.popularity, 0)) * 0.06)::real
   from public.tv_shows t
   where t.title % term
     and t.source_key is not null
     and coalesce(t.year, 0) <= max_year
   order by 13 desc
   limit n)
  union all
  (select 'book'::text, b.id, b.title, b.year, b.genre, b.cover_url, b.author,
          b.source_key, null::text, null::text, null::numeric, null::numeric,
          greatest(similarity(b.title, term), similarity(coalesce(b.author, ''), term))::real
   from public.books b
   where (b.title % term or b.author % term)
     and b.source_key is not null
   order by 13 desc
   limit n);
end;
$$;

grant execute on function public.search_catalog(text, integer) to anon, authenticated;
