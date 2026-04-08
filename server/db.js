const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
const repoDataDir = path.join(__dirname, '..', 'data');
const plexMoviesDataPath = path.join(repoDataDir, 'plex_movies.json');
const plexTvDataPath = path.join(repoDataDir, 'plex_tv.json');
const plexMoviesBulkDataPath = path.join(repoDataDir, 'plex_movies.bulk.jsonl');
const plexTvBulkDataPath = path.join(repoDataDir, 'plex_tv.bulk.jsonl');
const tmdbMoviesDataPath = path.join(repoDataDir, 'tmdb_movies.json');
const tmdbTvDataPath = path.join(repoDataDir, 'tmdb_tv.json');
const tmdbMoviesBulkDataPath = path.join(repoDataDir, 'tmdb_movies.bulk.jsonl');
const tmdbTvBulkDataPath = path.join(repoDataDir, 'tmdb_tv.bulk.jsonl');
const internetArchiveBooksDataPath = path.join(repoDataDir, 'internet_archive_books.json');
const internetArchiveBooksBulkDataPath = path.join(repoDataDir, 'internet_archive_books.bulk.jsonl');
const openLibraryDataPath = path.join(repoDataDir, 'openlibrary.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const plexMovieBulkSyncState = {
  offset: 0,
  remainder: '',
  size: 0,
};

const plexTvBulkSyncState = {
  offset: 0,
  remainder: '',
  size: 0,
};

const tmdbMovieBulkSyncState = {
  offset: 0,
  remainder: '',
  size: 0,
};

const tmdbTvBulkSyncState = {
  offset: 0,
  remainder: '',
  size: 0,
};

const archiveBulkSyncState = {
  offset: 0,
  remainder: '',
  size: 0,
};

const sourceCleanupState = {
  movies: false,
  tv: false,
};

function hasColumn(tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Unable to parse seed file: ${filePath}`, error);
    return null;
  }
}

function fileHasContent(filePath) {
  if (!fs.existsSync(filePath)) return false;

  try {
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function normalizeString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeYear(value) {
  if (value == null || value === '') return null;
  const match = String(value).match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

function pickFirstString(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = pickFirstString(item);
      if (match) return match;
    }
  }

  if (typeof value === 'object') {
    return pickFirstString(value.value);
  }

  return null;
}

function deleteImportedRowsByPrefix(tableName, sourcePrefix) {
  db.prepare(`DELETE FROM ${tableName} WHERE source_key LIKE ?`).run(`${sourcePrefix}%`);
}

function normalizeGenreLabel(subject) {
  if (!subject) return null;

  return String(subject)
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*fiction.*$/i, '')
    .replace(/\s*\(fictional works by one author\)$/i, '')
    .trim();
}

function pickBookGenre(subjects = []) {
  const preferredPatterns = [
    [/science fiction/i, 'Science Fiction'],
    [/mystery/i, 'Mystery'],
    [/detective/i, 'Mystery'],
    [/romance/i, 'Romance'],
    [/fantasy/i, 'Fantasy'],
    [/magic realism/i, 'Magic Realism'],
    [/classic literature/i, 'Classic Literature'],
    [/gothic fiction/i, 'Gothic Fiction'],
    [/historical/i, 'Historical Fiction'],
    [/thriller/i, 'Thriller'],
  ];

  for (const [pattern, label] of preferredPatterns) {
    const match = subjects.find((subject) => pattern.test(subject));
    if (match) {
      return label;
    }
  }

  const fallback = subjects.find((subject) => {
    const label = String(subject).toLowerCase();
    return (
      label &&
      !/^fiction\b/.test(label) &&
      !/^literature\b/.test(label) &&
      !label.includes('reading level') &&
      !label.includes('translations into') &&
      !label.includes('open library') &&
      !label.includes('award:') &&
      !label.includes('nyt:') &&
      !label.includes('language') &&
      !label.includes('long now manual for civilization')
    );
  });

  return normalizeGenreLabel(fallback || subjects[0]) || 'General Fiction';
}

function extractSynopsis(doc, workDescriptionById) {
  if (doc?.workId && workDescriptionById.has(doc.workId)) {
    return workDescriptionById.get(doc.workId);
  }

  const firstSentence = pickFirstString(doc?.raw?.first_sentence);
  if (firstSentence) return firstSentence;

  return normalizeGenreLabel(doc?.subtitle) || 'No description available yet.';
}

function createBookUpsertStatement() {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_books_source_key ON books(source_key)');

  return db.prepare(`
    INSERT INTO books (title, author, year, genre, synopsis, cover_url, source_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      year = excluded.year,
      genre = excluded.genre,
      synopsis = excluded.synopsis,
      cover_url = excluded.cover_url
  `);
}

function syncArchiveBookItems(items) {
  if (!Array.isArray(items) || items.length === 0) return false;

  const upsertBook = createBookUpsertStatement();
  const sync = db.transaction((records) => {
    for (const item of records) {
      const title = normalizeString(item?.title);
      if (!title) continue;

      const author = normalizeString(item?.author);
      const year = normalizeYear(item?.year);
      const genre = normalizeString(item?.genre) || 'General Interest';
      const synopsis =
        normalizeString(item?.synopsis || item?.description) || 'No description available yet.';
      const coverUrl = normalizeString(item?.coverUrl || item?.cover_url);
      const sourceKey =
        normalizeString(item?.sourceKey) ||
        `internet-archive:${normalizeString(item?.identifier) || `${title}:${author || ''}`}`;

      upsertBook.run(title, author, year, genre, synopsis, coverUrl, sourceKey);
    }
  });

  sync(items);
  return true;
}

function syncJsonlSeedFile(filePath, syncState, syncItems) {
  if (!fs.existsSync(filePath)) return false;

  const stats = fs.statSync(filePath);
  if (stats.size < syncState.offset) {
    syncState.offset = 0;
    syncState.remainder = '';
    syncState.size = 0;
  }

  if (stats.size === syncState.size) {
    return stats.size > 0;
  }

  const fileDescriptor = fs.openSync(filePath, 'r');

  try {
    const bytesToRead = stats.size - syncState.offset;
    const chunk = bytesToRead > 0 ? Buffer.alloc(bytesToRead) : Buffer.alloc(0);
    if (bytesToRead > 0) {
      fs.readSync(fileDescriptor, chunk, 0, bytesToRead, syncState.offset);
    }

    const combinedText = `${syncState.remainder}${chunk.toString('utf8')}`;
    const normalizedText = combinedText.replace(/\r\n/g, '\n');
    const hasTrailingNewline = normalizedText.endsWith('\n');
    const lines = normalizedText.split('\n');

    syncState.remainder = hasTrailingNewline ? '' : lines.pop() || '';
    const records = lines
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    syncState.offset = stats.size;
    syncState.size = stats.size;

    return syncItems(records);
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function syncMovieItems(items) {
  if (!Array.isArray(items) || items.length === 0) return false;

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_source_key ON movies(source_key)');

  const upsertMovie = db.prepare(`
    INSERT INTO movies (title, year, genre, director, writers, cast_members, age_rating, overview, synopsis, poster_url, source_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      title = excluded.title,
      year = excluded.year,
      genre = excluded.genre,
      director = excluded.director,
      writers = excluded.writers,
      cast_members = excluded.cast_members,
      age_rating = excluded.age_rating,
      overview = excluded.overview,
      synopsis = excluded.synopsis,
      poster_url = excluded.poster_url
  `);

  const sync = db.transaction((records) => {
    for (const item of records) {
      const title = normalizeString(item?.title);
      if (!title) continue;

      const sourceKey = normalizeString(item?.sourceKey) || `tmdb:movie:${title}`;
      upsertMovie.run(
        title,
        normalizeYear(item?.year || item?.releaseDate),
        normalizeString(item?.genre),
        normalizeString(item?.director),
        normalizeString(item?.writers),
        normalizeString(item?.cast || item?.cast_members),
        normalizeString(item?.ageRating || item?.age_rating),
        normalizeString(item?.overview || item?.synopsis) || 'No description available yet.',
        normalizeString(item?.synopsis) || 'No description available yet.',
        normalizeString(item?.posterUrl || item?.poster_url),
        sourceKey
      );
    }
  });

  sync(items);
  return true;
}

function syncMoviesFromTmdb() {
  const parsed = readJsonIfExists(tmdbMoviesDataPath);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return syncMovieItems(items);
}

function syncMoviesFromPlex() {
  const parsed = readJsonIfExists(plexMoviesDataPath);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return syncMovieItems(items);
}

function syncMoviesFromTmdbBulk() {
  return syncJsonlSeedFile(tmdbMoviesBulkDataPath, tmdbMovieBulkSyncState, syncMovieItems);
}

function syncMoviesFromPlexBulk() {
  return syncJsonlSeedFile(plexMoviesBulkDataPath, plexMovieBulkSyncState, syncMovieItems);
}

function syncTvShowItems(items) {
  if (!Array.isArray(items) || items.length === 0) return false;

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tv_shows_source_key ON tv_shows(source_key)');

  const upsertShow = db.prepare(`
    INSERT INTO tv_shows (title, year, genre, creator, writers, cast_members, age_rating, overview, synopsis, poster_url, seasons, source_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      title = excluded.title,
      year = excluded.year,
      genre = excluded.genre,
      creator = excluded.creator,
      writers = excluded.writers,
      cast_members = excluded.cast_members,
      age_rating = excluded.age_rating,
      overview = excluded.overview,
      synopsis = excluded.synopsis,
      poster_url = excluded.poster_url,
      seasons = excluded.seasons
  `);

  const sync = db.transaction((records) => {
    for (const item of records) {
      const title = normalizeString(item?.title);
      if (!title) continue;

      const sourceKey = normalizeString(item?.sourceKey) || `tmdb:tv:${title}`;
      upsertShow.run(
        title,
        normalizeYear(item?.year || item?.releaseDate),
        normalizeString(item?.genre),
        normalizeString(item?.creator),
        normalizeString(item?.writers),
        normalizeString(item?.cast || item?.cast_members),
        normalizeString(item?.ageRating || item?.age_rating),
        normalizeString(item?.overview || item?.synopsis) || 'No description available yet.',
        normalizeString(item?.synopsis) || 'No description available yet.',
        normalizeString(item?.posterUrl || item?.poster_url),
        Number.isFinite(Number(item?.seasons)) ? Number(item.seasons) : null,
        sourceKey
      );
    }
  });

  sync(items);
  return true;
}

function syncTvShowsFromTmdb() {
  const parsed = readJsonIfExists(tmdbTvDataPath);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return syncTvShowItems(items);
}

function syncTvShowsFromPlex() {
  const parsed = readJsonIfExists(plexTvDataPath);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return syncTvShowItems(items);
}

function syncTvShowsFromTmdbBulk() {
  return syncJsonlSeedFile(tmdbTvBulkDataPath, tmdbTvBulkSyncState, syncTvShowItems);
}

function syncTvShowsFromPlexBulk() {
  return syncJsonlSeedFile(plexTvBulkDataPath, plexTvBulkSyncState, syncTvShowItems);
}

function syncBooksFromInternetArchive() {
  const parsed = readJsonIfExists(internetArchiveBooksDataPath);
  const items = Array.isArray(parsed?.books)
    ? parsed.books
    : Array.isArray(parsed?.items)
      ? parsed.items
      : [];
  return syncArchiveBookItems(items);
}

function syncBooksFromInternetArchiveBulk() {
  return syncJsonlSeedFile(
    internetArchiveBooksBulkDataPath,
    archiveBulkSyncState,
    syncArchiveBookItems
  );
}

function syncBooksFromOpenLibrary() {
  if (!fs.existsSync(openLibraryDataPath)) return;

  try {
    const parsed = JSON.parse(fs.readFileSync(openLibraryDataPath, 'utf8'));
    const docs = Array.isArray(parsed?.search?.docs) ? parsed.search.docs : [];
    if (!docs.length) return;

    const workDescriptionById = new Map();
    if (parsed?.workDetail?.workId && parsed?.workDetail?.description) {
      workDescriptionById.set(parsed.workDetail.workId, pickFirstString(parsed.workDetail.description));
    }

    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_books_source_key ON books(source_key)');

    const upsertBook = db.prepare(`
      INSERT INTO books (title, author, year, genre, synopsis, cover_url, source_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        title = excluded.title,
        author = excluded.author,
        year = excluded.year,
        genre = excluded.genre,
        synopsis = excluded.synopsis,
        cover_url = excluded.cover_url
    `);

    const sync = db.transaction((records) => {
      for (const doc of records) {
        const title = typeof doc?.title === 'string' ? doc.title.trim() : '';
        if (!title) continue;

        const author = Array.isArray(doc?.authors)
          ? doc.authors.filter(Boolean).join(', ')
          : '';
        const year = Number.isFinite(Number(doc?.firstPublishedYear))
          ? Number(doc.firstPublishedYear)
          : null;
        const genre = pickBookGenre(Array.isArray(doc?.subjects) ? doc.subjects : []);
        const synopsis = extractSynopsis(doc, workDescriptionById);
        const coverUrl = typeof doc?.coverUrl === 'string' ? doc.coverUrl.trim() : null;
        const sourceKey = `openlibrary:${doc?.workId || doc?.key || `${title}:${author}`}`;

        upsertBook.run(title, author, year, genre, synopsis, coverUrl, sourceKey);
      }
    });

    sync(docs);
  } catch (error) {
    console.error('Unable to sync books from Open Library data file:', error);
  }
}

function preferPlexMovieImports() {
  return fileHasContent(plexMoviesBulkDataPath) || fileHasContent(plexMoviesDataPath);
}

function preferPlexTvImports() {
  return fileHasContent(plexTvBulkDataPath) || fileHasContent(plexTvDataPath);
}

function cleanupLegacyMovieImportsIfNeeded() {
  if (sourceCleanupState.movies || !preferPlexMovieImports()) return;

  deleteImportedRowsByPrefix('movies', 'tmdb:');
  sourceCleanupState.movies = true;
}

function cleanupLegacyTvImportsIfNeeded() {
  if (sourceCleanupState.tv || !preferPlexTvImports()) return;

  deleteImportedRowsByPrefix('tv_shows', 'tmdb:');
  sourceCleanupState.tv = true;
}

function syncPreferredMovies() {
  if (preferPlexMovieImports()) {
    cleanupLegacyMovieImportsIfNeeded();
    return syncMoviesFromPlexBulk() || syncMoviesFromPlex();
  }

  return syncMoviesFromTmdbBulk() || syncMoviesFromTmdb();
}

function syncPreferredTvShows() {
  if (preferPlexTvImports()) {
    cleanupLegacyTvImportsIfNeeded();
    return syncTvShowsFromPlexBulk() || syncTvShowsFromPlex();
  }

  return syncTvShowsFromTmdbBulk() || syncTvShowsFromTmdb();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tv_shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    year INTEGER,
    genre TEXT,
    synopsis TEXT,
    cover_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv_show', 'book')),
    media_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    review TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (user_id, media_type, media_id)
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv_show', 'book')),
    media_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'plan_to_watch',
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (user_id, media_type, media_id)
  );
`);

if (!hasColumn('users', 'bio')) {
  db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
}

if (!hasColumn('users', 'avatar_url')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
}

if (!hasColumn('books', 'source_key')) {
  db.exec('ALTER TABLE books ADD COLUMN source_key TEXT');
}

if (!hasColumn('movies', 'source_key')) {
  db.exec('ALTER TABLE movies ADD COLUMN source_key TEXT');
}

if (!hasColumn('movies', 'writers')) {
  db.exec('ALTER TABLE movies ADD COLUMN writers TEXT');
}

if (!hasColumn('movies', 'cast_members')) {
  db.exec('ALTER TABLE movies ADD COLUMN cast_members TEXT');
}

if (!hasColumn('movies', 'age_rating')) {
  db.exec('ALTER TABLE movies ADD COLUMN age_rating TEXT');
}

if (!hasColumn('movies', 'overview')) {
  db.exec('ALTER TABLE movies ADD COLUMN overview TEXT');
}

if (!hasColumn('tv_shows', 'source_key')) {
  db.exec('ALTER TABLE tv_shows ADD COLUMN source_key TEXT');
}

if (!hasColumn('tv_shows', 'writers')) {
  db.exec('ALTER TABLE tv_shows ADD COLUMN writers TEXT');
}

if (!hasColumn('tv_shows', 'cast_members')) {
  db.exec('ALTER TABLE tv_shows ADD COLUMN cast_members TEXT');
}

if (!hasColumn('tv_shows', 'age_rating')) {
  db.exec('ALTER TABLE tv_shows ADD COLUMN age_rating TEXT');
}

if (!hasColumn('tv_shows', 'overview')) {
  db.exec('ALTER TABLE tv_shows ADD COLUMN overview TEXT');
}

syncPreferredMovies();
syncPreferredTvShows();

const didSyncArchiveBooks = syncBooksFromInternetArchiveBulk() || syncBooksFromInternetArchive();
if (!didSyncArchiveBooks) {
  syncBooksFromOpenLibrary();
}

db.syncImportedMovies = () => {
  syncPreferredMovies();
};

db.syncImportedTvShows = () => {
  syncPreferredTvShows();
};

db.syncImportedBooks = () => {
  syncBooksFromInternetArchiveBulk();
};

module.exports = db;
