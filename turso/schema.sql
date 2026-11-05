-- binge. media catalog on Turso (libSQL / SQLite). Supabase keeps Auth and
-- every user-owned table; nothing lives in both (docs/database-split.md).
--
-- Turso bills rows *scanned*, so every query the app runs needs an index
-- (check with EXPLAIN QUERY PLAN: "SCAN movies" = one read per row).
-- Idempotent: node scripts/turso-catalog.js schema
--
-- Conventions
--   ids           INTEGER PRIMARY KEY (new rows get max(id)+1, like Neon's identity)
--   timestamps    ISO-8601 text, e.g. 2026-11-04T23:10:05.123Z
--   numeric       REAL
--   jsonb         TEXT holding JSON (server/catalogDb.js parses JSON_COLUMNS)
--   search_*      columns are written by the app (server/catalogSearch.js:
--                 searchColumns) and never returned to clients

CREATE TABLE IF NOT EXISTS movies (
  id INTEGER PRIMARY KEY,
  title TEXT,
  year INTEGER,
  genre TEXT,
  director TEXT,
  writers TEXT,
  cast_members TEXT,
  age_rating TEXT,
  overview TEXT,
  synopsis TEXT,
  poster_url TEXT,
  source_key TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  external_id TEXT,
  release_date TEXT,
  imdb_id TEXT,
  vote_average REAL,
  popularity REAL,
  rotten_tomatoes_score INTEGER,
  imdb_rating REAL,
  metacritic_score INTEGER,
  ratings_enriched_at TEXT,
  original_language TEXT,
  search_norm TEXT,
  search_squash TEXT
);

CREATE TABLE IF NOT EXISTS tv_shows (
  id INTEGER PRIMARY KEY,
  title TEXT,
  year INTEGER,
  genre TEXT,
  creator TEXT,
  writers TEXT,
  cast_members TEXT,
  age_rating TEXT,
  overview TEXT,
  synopsis TEXT,
  poster_url TEXT,
  seasons INTEGER,
  source_key TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  external_id TEXT,
  original_language TEXT,
  release_date TEXT,
  imdb_id TEXT,
  vote_average REAL,
  popularity REAL,
  search_norm TEXT,
  search_squash TEXT
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  title TEXT,
  author TEXT,
  year INTEGER,
  genre TEXT,
  synopsis TEXT,
  cover_url TEXT,
  source_key TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  item_url TEXT,
  external_id TEXT,
  search_norm TEXT,
  search_squash TEXT,
  search_author TEXT
);

-- Shared caches written by the server (OMDb ratings, IMDb episode ratings,
-- OpenSubtitles files).
CREATE TABLE IF NOT EXISTS title_ratings (
  source_key TEXT PRIMARY KEY,
  imdb_id TEXT,
  imdb_rating REAL,
  imdb_votes INTEGER,
  rotten_tomatoes INTEGER,
  metacritic INTEGER,
  fetched_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS episode_ratings_cache (
  imdb_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  episodes TEXT,
  fetched_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (imdb_id, season)
);

CREATE TABLE IF NOT EXISTS subtitle_cache (
  key TEXT PRIMARY KEY,
  vtt TEXT,
  release TEXT,
  versions INTEGER,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Genre lists and row counts, refreshed after every sync
-- (scripts/turso-catalog.js refresh). Computing them live reads every row.
CREATE TABLE IF NOT EXISTS catalog_genres (
  kind TEXT NOT NULL,
  genre TEXT NOT NULL,
  PRIMARY KEY (kind, genre)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS catalog_stats (
  name TEXT PRIMARY KEY,
  value INTEGER,
  updated_at TEXT
);

CREATE VIEW IF NOT EXISTS movie_genres AS SELECT genre FROM catalog_genres WHERE kind = 'movies';
CREATE VIEW IF NOT EXISTS tv_show_genres AS SELECT genre FROM catalog_genres WHERE kind = 'tv_shows';
CREATE VIEW IF NOT EXISTS book_genres AS SELECT genre FROM catalog_genres WHERE kind = 'books';

-- Lookups
CREATE UNIQUE INDEX IF NOT EXISTS movies_source_key ON movies (source_key);
CREATE UNIQUE INDEX IF NOT EXISTS movies_external_id ON movies (external_id);
CREATE INDEX IF NOT EXISTS movies_imdb_id ON movies (imdb_id);
CREATE UNIQUE INDEX IF NOT EXISTS tv_shows_source_key ON tv_shows (source_key);
CREATE UNIQUE INDEX IF NOT EXISTS tv_shows_external_id ON tv_shows (external_id);
CREATE INDEX IF NOT EXISTS tv_shows_imdb_id ON tv_shows (imdb_id);
CREATE UNIQUE INDEX IF NOT EXISTS books_source_key ON books (source_key);
CREATE UNIQUE INDEX IF NOT EXISTS books_external_id ON books (external_id);

-- Browse orders (SQLite sorts NULL lowest, so DESC already puts NULLs last)
CREATE INDEX IF NOT EXISTS movies_popularity ON movies (popularity DESC) WHERE poster_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS movies_language_popularity ON movies (original_language, popularity DESC) WHERE poster_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS movies_release_date ON movies (release_date) WHERE poster_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS movies_year ON movies (year);
CREATE INDEX IF NOT EXISTS movies_title ON movies (title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS movies_vote_average ON movies (vote_average DESC) WHERE poster_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS movies_ratings_enriched_at ON movies (ratings_enriched_at);
-- Rows the backfill still has to fill (scripts/backfill-catalog-fields.js)
CREATE INDEX IF NOT EXISTS movies_missing_popularity ON movies (id) WHERE popularity IS NULL;
CREATE INDEX IF NOT EXISTS tv_shows_missing_popularity ON tv_shows (id) WHERE popularity IS NULL;
CREATE INDEX IF NOT EXISTS tv_shows_popularity ON tv_shows (popularity DESC) WHERE poster_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS tv_shows_language_popularity ON tv_shows (original_language, popularity DESC) WHERE poster_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS tv_shows_release_date ON tv_shows (release_date) WHERE poster_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS tv_shows_year ON tv_shows (year);
CREATE INDEX IF NOT EXISTS tv_shows_title ON tv_shows (title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS tv_shows_vote_average ON tv_shows (vote_average DESC) WHERE poster_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS books_year ON books (year);
CREATE INDEX IF NOT EXISTS books_title ON books (title COLLATE NOCASE);

-- Search (server/catalogSearch.js). Exact/prefix matches use these B-trees;
-- substrings and typos use the trigram FTS tables below.
CREATE INDEX IF NOT EXISTS movies_search_norm ON movies (search_norm);
CREATE INDEX IF NOT EXISTS movies_search_squash ON movies (search_squash);
CREATE INDEX IF NOT EXISTS tv_shows_search_norm ON tv_shows (search_norm);
CREATE INDEX IF NOT EXISTS tv_shows_search_squash ON tv_shows (search_squash);
CREATE INDEX IF NOT EXISTS books_search_norm ON books (search_norm);
CREATE INDEX IF NOT EXISTS books_search_author ON books (search_author);

CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(
  search_norm, search_squash, content = 'movies', content_rowid = 'id', tokenize = 'trigram'
);
CREATE VIRTUAL TABLE IF NOT EXISTS tv_shows_fts USING fts5(
  search_norm, search_squash, content = 'tv_shows', content_rowid = 'id', tokenize = 'trigram'
);
CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
  search_norm, search_author, content = 'books', content_rowid = 'id', tokenize = 'trigram'
);

-- Keep the FTS tables in step with their rows (external-content pattern).
CREATE TRIGGER IF NOT EXISTS movies_fts_insert AFTER INSERT ON movies BEGIN
  INSERT INTO movies_fts (rowid, search_norm, search_squash) VALUES (new.id, new.search_norm, new.search_squash);
END;
CREATE TRIGGER IF NOT EXISTS movies_fts_delete AFTER DELETE ON movies BEGIN
  INSERT INTO movies_fts (movies_fts, rowid, search_norm, search_squash) VALUES ('delete', old.id, old.search_norm, old.search_squash);
END;
CREATE TRIGGER IF NOT EXISTS movies_fts_update AFTER UPDATE OF search_norm, search_squash ON movies
  WHEN old.search_norm IS NOT new.search_norm OR old.search_squash IS NOT new.search_squash BEGIN
  INSERT INTO movies_fts (movies_fts, rowid, search_norm, search_squash) VALUES ('delete', old.id, old.search_norm, old.search_squash);
  INSERT INTO movies_fts (rowid, search_norm, search_squash) VALUES (new.id, new.search_norm, new.search_squash);
END;

CREATE TRIGGER IF NOT EXISTS tv_shows_fts_insert AFTER INSERT ON tv_shows BEGIN
  INSERT INTO tv_shows_fts (rowid, search_norm, search_squash) VALUES (new.id, new.search_norm, new.search_squash);
END;
CREATE TRIGGER IF NOT EXISTS tv_shows_fts_delete AFTER DELETE ON tv_shows BEGIN
  INSERT INTO tv_shows_fts (tv_shows_fts, rowid, search_norm, search_squash) VALUES ('delete', old.id, old.search_norm, old.search_squash);
END;
CREATE TRIGGER IF NOT EXISTS tv_shows_fts_update AFTER UPDATE OF search_norm, search_squash ON tv_shows
  WHEN old.search_norm IS NOT new.search_norm OR old.search_squash IS NOT new.search_squash BEGIN
  INSERT INTO tv_shows_fts (tv_shows_fts, rowid, search_norm, search_squash) VALUES ('delete', old.id, old.search_norm, old.search_squash);
  INSERT INTO tv_shows_fts (rowid, search_norm, search_squash) VALUES (new.id, new.search_norm, new.search_squash);
END;

CREATE TRIGGER IF NOT EXISTS books_fts_insert AFTER INSERT ON books BEGIN
  INSERT INTO books_fts (rowid, search_norm, search_author) VALUES (new.id, new.search_norm, new.search_author);
END;
CREATE TRIGGER IF NOT EXISTS books_fts_delete AFTER DELETE ON books BEGIN
  INSERT INTO books_fts (books_fts, rowid, search_norm, search_author) VALUES ('delete', old.id, old.search_norm, old.search_author);
END;
CREATE TRIGGER IF NOT EXISTS books_fts_update AFTER UPDATE OF search_norm, search_author ON books
  WHEN old.search_norm IS NOT new.search_norm OR old.search_author IS NOT new.search_author BEGIN
  INSERT INTO books_fts (books_fts, rowid, search_norm, search_author) VALUES ('delete', old.id, old.search_norm, old.search_author);
  INSERT INTO books_fts (rowid, search_norm, search_author) VALUES (new.id, new.search_norm, new.search_author);
END;
