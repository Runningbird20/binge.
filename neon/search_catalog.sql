-- Catalog search (Neon). Titles and authors are compared in a normalized
-- form: lowercase, accents removed, punctuation turned into spaces, so
-- "amelie" finds Amélie, "leon the professional" finds Léon: The Professional
-- and "garcia marquez" finds García Márquez. A squashed form (no spaces)
-- catches "xmen" / "walle" / "spiderman", and a leading "the/a/an" is ignored
-- when comparing, so "office" ranks The Office as an exact match. Typos fall
-- back to trigram similarity ("brekaing bad") and word similarity, which
-- matches a typo inside a longer title ("harry poter"; default threshold 0.6).
-- Idempotent; run with: psql "$DATABASE_URL_UNPOOLED" -f neon/search_catalog.sql
-- (not inside a transaction: the indexes are built CONCURRENTLY).

create extension if not exists unaccent with schema public;

-- Lowercase, accents removed, anything but letters/digits (any script) -> one
-- space. IMMUTABLE so it can be indexed; the dictionary is named explicitly,
-- which is what makes unaccent safe to treat as immutable.
create or replace function public.search_norm(t text)
returns text
language sql
immutable
parallel safe
strict
as $$
  select trim(regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, t)), '[^[:alnum:]]+', ' ', 'g'))
$$;

create index concurrently if not exists idx_movies_title_norm_trgm on public.movies using gin (public.search_norm(title) gin_trgm_ops);
create index concurrently if not exists idx_movies_title_squash_trgm on public.movies using gin (replace(public.search_norm(title), ' ', '') gin_trgm_ops);
create index concurrently if not exists idx_tv_shows_title_norm_trgm on public.tv_shows using gin (public.search_norm(title) gin_trgm_ops);
create index concurrently if not exists idx_tv_shows_title_squash_trgm on public.tv_shows using gin (replace(public.search_norm(title), ' ', '') gin_trgm_ops);
create index concurrently if not exists idx_books_title_norm_trgm on public.books using gin (public.search_norm(title) gin_trgm_ops);
create index concurrently if not exists idx_books_author_norm_trgm on public.books using gin (public.search_norm(author) gin_trgm_ops);

-- Load pg_trgm in this session: setting its threshold on the function below
-- is only allowed once the library has registered the setting.
select public.show_trgm('');

create or replace function public.search_catalog(q text, lim integer default 24)
returns table(result_type text, id bigint, title text, year integer, genre text, poster_url text, author text, source_key text, release_date text, original_language text, popularity numeric, vote_average numeric, score real)
language plpgsql
stable
set search_path to 'public'
set "pg_trgm.similarity_threshold" to '0.45'
as $function$
declare
  qn text := public.search_norm(coalesce(q, ''));
  qc text;            -- without a leading article
  qs text;            -- squashed (no spaces)
  contains text;
  core_prefix text;
  squash text;
  n integer := least(greatest(coalesce(lim, 24), 1), 60);
  cutoff text := (current_date + 30)::text;
  max_year integer := extract(year from current_date)::int;
  batch integer;
begin
  if char_length(coalesce(qn, '')) < 2 then
    return;
  end if;
  qc := regexp_replace(qn, '^(the|a|an) ', '');
  qs := replace(qn, ' ', '');
  -- Substring match only for 4+ characters: "the"/"of" as a substring
  -- would match most of the catalog. Normalized text has no LIKE wildcards.
  contains := case when char_length(qn) >= 4 then '%' || qn || '%' else qn || '%' end;
  core_prefix := case when qc <> qn then '%' || qc || '%' else contains end;
  squash := case when char_length(qs) >= 4 then '%' || qs || '%' else null end;

  -- Pass 1: exact / prefix / substring on the normalized title. An exact
  -- match ignoring a leading article counts as exact.
  return query
  (select 'movie'::text, m.id, m.title, m.year, m.genre, m.poster_url, null::text,
          m.source_key, m.release_date, m.original_language, m.popularity, m.vote_average,
          (similarity(k.core, qc)
            + case when k.norm = qn or replace(k.norm, ' ', '') = qs then 1.0
                   -- Equal once a leading article is dropped ("office" vs The
                   -- Office). Below a true exact match, since stored
                   -- popularity is missing for many big titles.
                   when k.core = qc then 0.85
                   when k.norm like qn || '%' or k.core like qc || '%' or replace(k.norm, ' ', '') like qs || '%' then 0.45
                   else 0.15 end
            + ln(1 + coalesce(m.popularity, 0)) * 0.06)::real
   from public.movies m
   cross join lateral (select public.search_norm(m.title) as norm,
                              regexp_replace(public.search_norm(m.title), '^(the|a|an) ', '') as core) k
   where (public.search_norm(m.title) like contains
          or public.search_norm(m.title) like core_prefix
          or replace(public.search_norm(m.title), ' ', '') like squash)
     and m.source_key is not null
     and coalesce(m.release_date, '0000') <= cutoff
     and coalesce(m.year, 0) <= max_year + 1
   order by 13 desc
   limit n)
  union all
  (select 'tv'::text, t.id, t.title, t.year, t.genre, t.poster_url, null::text,
          t.source_key, t.release_date, t.original_language, t.popularity, t.vote_average,
          (similarity(k.core, qc)
            + case when k.norm = qn or replace(k.norm, ' ', '') = qs then 1.0
                   -- Equal once a leading article is dropped ("office" vs The
                   -- Office). Below a true exact match, since stored
                   -- popularity is missing for many big titles.
                   when k.core = qc then 0.85
                   when k.norm like qn || '%' or k.core like qc || '%' or replace(k.norm, ' ', '') like qs || '%' then 0.45
                   else 0.15 end
            + ln(1 + coalesce(t.popularity, 0)) * 0.06)::real
   from public.tv_shows t
   cross join lateral (select public.search_norm(t.title) as norm,
                              regexp_replace(public.search_norm(t.title), '^(the|a|an) ', '') as core) k
   where (public.search_norm(t.title) like contains
          or public.search_norm(t.title) like core_prefix
          or replace(public.search_norm(t.title), ' ', '') like squash)
     and t.source_key is not null
     and coalesce(t.year, 0) <= max_year
   order by 13 desc
   limit n)
  union all
  (select 'book'::text, b.id, b.title, b.year, b.genre, b.cover_url, b.author,
          b.source_key, null::text, null::text, null::numeric, null::numeric,
          (greatest(similarity(k.core, qc), similarity(coalesce(public.search_norm(b.author), ''), qn))
            + case when k.norm = qn or replace(k.norm, ' ', '') = qs then 1.0
                   -- Equal once a leading article is dropped ("office" vs The
                   -- Office). Below a true exact match, since stored
                   -- popularity is missing for many big titles.
                   when k.core = qc then 0.85
                   when k.norm like qn || '%' or k.core like qc || '%' or replace(k.norm, ' ', '') like qs || '%' then 0.45
                   else 0.15 end)::real
   from public.books b
   cross join lateral (select public.search_norm(b.title) as norm,
                              regexp_replace(public.search_norm(b.title), '^(the|a|an) ', '') as core) k
   where (public.search_norm(b.title) like contains
          or public.search_norm(b.title) like core_prefix
          or public.search_norm(b.author) like contains)
     and b.source_key is not null
   order by 13 desc
   limit n);

  get diagnostics batch = row_count;
  if batch >= 6 then
    return;
  end if;

  -- Pass 2: typos. Whole-title similarity catches swapped letters ("brekaing
  -- bad"); word similarity compares the query with the best-matching stretch
  -- of the title, so "harry poter" finds "Harry Potter and the ...".
  -- May repeat a pass-1 row; the client keeps the highest score per id.
  return query
  (select 'movie'::text, m.id, m.title, m.year, m.genre, m.poster_url, null::text,
          m.source_key, m.release_date, m.original_language, m.popularity, m.vote_average,
          (greatest(similarity(public.search_norm(m.title), qn), word_similarity(qn, public.search_norm(m.title))) + ln(1 + coalesce(m.popularity, 0)) * 0.06)::real
   from public.movies m
   where (public.search_norm(m.title) % qn or qn <% public.search_norm(m.title))
     and m.source_key is not null
     and coalesce(m.release_date, '0000') <= cutoff
     and coalesce(m.year, 0) <= max_year + 1
   order by 13 desc
   limit n)
  union all
  (select 'tv'::text, t.id, t.title, t.year, t.genre, t.poster_url, null::text,
          t.source_key, t.release_date, t.original_language, t.popularity, t.vote_average,
          (greatest(similarity(public.search_norm(t.title), qn), word_similarity(qn, public.search_norm(t.title))) + ln(1 + coalesce(t.popularity, 0)) * 0.06)::real
   from public.tv_shows t
   where (public.search_norm(t.title) % qn or qn <% public.search_norm(t.title))
     and t.source_key is not null
     and coalesce(t.year, 0) <= max_year
   order by 13 desc
   limit n)
  union all
  (select 'book'::text, b.id, b.title, b.year, b.genre, b.cover_url, b.author,
          b.source_key, null::text, null::text, null::numeric, null::numeric,
          greatest(similarity(public.search_norm(b.title), qn), word_similarity(qn, public.search_norm(b.title)), word_similarity(qn, coalesce(public.search_norm(b.author), '')))::real
   from public.books b
   where (public.search_norm(b.title) % qn or qn <% public.search_norm(b.title) or qn <% public.search_norm(b.author))
     and b.source_key is not null
   order by 13 desc
   limit n);
end;
$function$;
