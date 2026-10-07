-- Book ids must fit in a JavaScript number (2^53 - 1). The Goodreads seed
-- built ids from the first 15 hex digits (60 bits) of a SHA-1, so 19,687 of
-- 19,844 books had ids the browser silently rounded — opening, rating or
-- saving almost any book used an id that matched nothing (as of
-- 2026-10-07 not a single watchlist/book_ratings row referenced a book).
--
-- New id = old id >> 8, i.e. the first 13 hex digits (52 bits) of the same
-- digest — exactly what scripts/generate-supabase-book-seed.js now
-- produces, so a future re-seed matches these rows instead of duplicating
-- them. Verified beforehand: zero collisions, max new id 4.5e15, no FKs
-- to books. References are remapped too in case any exist by the time
-- this runs.
do $$
begin
  if exists (
    select 1 from public.books
    group by (case when id > 9007199254740991 then id >> 8 else id end)
    having count(*) > 1
  ) then
    raise exception 'book id remap would collide; aborting';
  end if;
end;
$$;

update public.watchlist
set media_id = media_id >> 8
where media_type = 'book' and media_id > 9007199254740991;

update public.book_ratings
set media_id = media_id >> 8
where media_id > 9007199254740991;

update public.continue_watching
set media_id = media_id >> 8
where media_type = 'book' and media_id > 9007199254740991;

update public.books
set id = id >> 8
where id > 9007199254740991;
