-- Widen books.id from smallint to bigint so hash-based seed IDs fit.
-- The existing internet-archive seed IDs were small (sequential), but the
-- Goodreads seed uses SHA1-derived bigints that overflow smallint.

alter table public.books alter column id type bigint;
