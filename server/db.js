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
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -32000');
db.pragma('temp_store = MEMORY');

// ── Persistent sync state table ───────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS _sync_state (
    file_key TEXT PRIMARY KEY,
    signature TEXT NOT NULL,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function getSyncedSignature(fileKey) {
  try {
    const row = db.prepare('SELECT signature FROM _sync_state WHERE file_key = ?').get(fileKey);
    return row?.signature || null;
  } catch { return null; }
}

function setSyncedSignature(fileKey, signature) {
  try {
    db.prepare('INSERT OR REPLACE INTO _sync_state (file_key, signature, imported_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run(fileKey, signature);
  } catch { /* non-fatal */ }
}

function createSeedSyncState() {
  return { signature: null, loaded: false };
}

const plexMovieSyncState = createSeedSyncState();
const plexMovieBulkSyncState = createSeedSyncState();
const plexTvSyncState = createSeedSyncState();
const plexTvBulkSyncState = createSeedSyncState();
const tmdbMovieSyncState = createSeedSyncState();
const tmdbMovieBulkSyncState = createSeedSyncState();
const tmdbTvSyncState = createSeedSyncState();
const tmdbTvBulkSyncState = createSeedSyncState();
const archiveBookSyncState = createSeedSyncState();
const archiveBulkSyncState = createSeedSyncState();
const openLibrarySyncState = createSeedSyncState();

function hasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((col) => col.name === columnName);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (err) { console.error(`Unable to parse seed file: ${filePath}`, err); return null; }
}

function readJsonlIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch (err) { console.error(`Unable to parse JSONL seed file: ${filePath}`, err); return null; }
}

function fileHasContent(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try { return fs.statSync(filePath).size > 0; } catch { return false; }
}

function getFileSignature(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { const s = fs.statSync(filePath); return `${s.size}:${s.mtimeMs}`; } catch { return null; }
}

function resetSeedSyncState(syncState) {
  syncState.signature = null;
  syncState.loaded = false;
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
  if (typeof value === 'string') { const n = value.trim(); return n || null; }
  if (Array.isArray(value)) { for (const item of value) { const m = pickFirstString(item); if (m) return m; } }
  if (typeof value === 'object') return pickFirstString(value.value);
  return null;
}

function deleteImportedRowsByPrefix(tableName, sourcePrefix) {
  db.prepare(`DELETE FROM ${tableName} WHERE source_key LIKE ?`).run(`${sourcePrefix}%`);
}

function deleteImportedRowsWithoutSourceKey(tableName) {
  db.prepare(`DELETE FROM ${tableName} WHERE source_key IS NULL OR TRIM(source_key) = ''`).run();
}

function pruneImportedRows(tableName, activeSourcePrefixes = [], currentSourceKeys = [], inactiveSourcePrefixes = []) {
  const activePrefixes = activeSourcePrefixes.filter(Boolean);
  const keepSourceKeys = Array.from(new Set(currentSourceKeys.filter(Boolean)));
  const staleSourcePrefixes = inactiveSourcePrefixes.filter(Boolean);
  const tempTableName = `temp_${tableName}_source_keys`;

  deleteImportedRowsWithoutSourceKey(tableName);
  db.exec(`DROP TABLE IF EXISTS ${tempTableName}`);
  db.exec(`CREATE TEMP TABLE ${tempTableName} (source_key TEXT PRIMARY KEY)`);

  const insertSourceKey = db.prepare(`INSERT OR IGNORE INTO ${tempTableName} (source_key) VALUES (?)`);
  for (const sourceKey of keepSourceKeys) insertSourceKey.run(sourceKey);

  if (activePrefixes.length) {
    const prefixClause = activePrefixes.map(() => 'source_key LIKE ?').join(' OR ');
    const prefixParams = activePrefixes.map((p) => `${p}%`);
    db.prepare(`
      DELETE FROM ${tableName}
      WHERE (${prefixClause})
        AND NOT EXISTS (
          SELECT 1 FROM ${tempTableName}
          WHERE ${tempTableName}.source_key = ${tableName}.source_key
        )
    `).run(...prefixParams);
  }

  for (const sourcePrefix of staleSourcePrefixes) deleteImportedRowsByPrefix(tableName, sourcePrefix);
  db.exec(`DROP TABLE IF EXISTS ${tempTableName}`);
}

function syncJsonSeedFile(filePath, syncState, selectItems, syncItems, syncOptions = {}) {
  const signature = getFileSignature(filePath);
  if (!signature) { resetSeedSyncState(syncState); return false; }
  if (syncState.loaded && syncState.signature === signature) return true;
  const parsed = readJsonIfExists(filePath);
  if (parsed == null) return false;
  const items = selectItems(parsed);
  syncItems(Array.isArray(items) ? items : [], syncOptions);
  syncState.signature = signature;
  syncState.loaded = true;
  return true;
}

// FIX 1: Removed syncJsonlStreamBatched (it loaded whole file anyway — no benefit)
function syncJsonlSeedFile(filePath, syncState, syncItems, syncOptions = {}) {
  const signature = getFileSignature(filePath);
  if (!signature) { resetSeedSyncState(syncState); return false; }

  // Check in-process cache (fastest — same process lifetime)
  if (syncState.loaded && syncState.signature === signature) return true;

  // Check persistent DB cache — skip if already imported with same file signature
  const fileKey = path.basename(filePath);
  const persistedSig = getSyncedSignature(fileKey);
  if (persistedSig === signature) {
    syncState.signature = signature;
    syncState.loaded = true;
    console.log(`[db] Skipping ${fileKey} — already imported`);
    return true;
  }

  const fileSize = fs.statSync(filePath).size;
  const fileSizeMB = Math.round(fileSize / 1024 / 1024);
  console.log(`[db] Importing ${fileKey} (${fileSizeMB}MB)...`);

  // Stream line-by-line using a read buffer — never loads whole file into memory
  const BATCH = 1000;
  const CHUNK = 64 * 1024; // 64KB read chunks
  let batch = [];
  let total = 0;
  let leftover = '';

  // During batched import, NEVER prune — pruning per-batch deletes records from previous batches
  // Pass empty arrays for both prefix lists so pruneImportedRows is a no-op
  const batchOptions = { ...syncOptions, activeSourcePrefixes: [], inactiveSourcePrefixes: [] };

  const flush = () => {
    if (batch.length === 0) return;
    syncItems(batch, batchOptions);
    total += batch.length;
    batch = [];
  };

  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.allocUnsafe(CHUNK);
  let bytesRead;

  try {
    while ((bytesRead = fs.readSync(fd, buf, 0, CHUNK, null)) > 0) {
      const chunk = leftover + buf.subarray(0, bytesRead).toString('utf8');
      const lines = chunk.split('\n');
      // Last element may be incomplete — save for next chunk
      leftover = lines.pop();

      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const r = JSON.parse(t);
          if (r) batch.push(r);
        } catch { /* skip malformed lines */ }
        if (batch.length >= BATCH) flush();
      }
    }
    // Process any remaining leftover
    if (leftover.trim()) {
      try { const r = JSON.parse(leftover.trim()); if (r) batch.push(r); } catch {}
    }
    flush();
  } finally {
    fs.closeSync(fd);
  }

  console.log(`[db] Imported ${total} records from ${fileKey}`);
  setSyncedSignature(fileKey, signature);
  syncState.signature = signature;
  syncState.loaded = true;
  return true;
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
    if (subjects.find((s) => pattern.test(s))) return label;
  }
  const fallback = subjects.find((s) => {
    const l = String(s).toLowerCase();
    return l && !/^fiction\b/.test(l) && !/^literature\b/.test(l)
      && !l.includes('reading level') && !l.includes('translations into')
      && !l.includes('open library') && !l.includes('award:')
      && !l.includes('nyt:') && !l.includes('language')
      && !l.includes('long now manual for civilization');
  });
  return normalizeGenreLabel(fallback || subjects[0]) || 'General Fiction';
}

function extractSynopsis(doc, workDescriptionById) {
  if (doc?.workId && workDescriptionById.has(doc.workId)) return workDescriptionById.get(doc.workId);
  const firstSentence = pickFirstString(doc?.raw?.first_sentence);
  if (firstSentence) return firstSentence;
  return normalizeGenreLabel(doc?.subtitle) || 'No description available yet.';
}

function createBookUpsertStatement() {
  return db.prepare(`
    INSERT INTO books (title, author, year, genre, synopsis, cover_url, item_url, source_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      year = excluded.year,
      genre = excluded.genre,
      synopsis = excluded.synopsis,
      cover_url = excluded.cover_url,
      item_url = excluded.item_url
  `);
}

function syncArchiveBookItems(items, syncOptions = {}) {
  if (!Array.isArray(items)) return false;
  const upsertBook = createBookUpsertStatement();
  const sync = db.transaction((records) => {
    const sourceKeys = [];
    for (const item of records) {
      const title = normalizeString(item?.title);
      if (!title) continue;
      const author = normalizeString(item?.author);
      const year = normalizeYear(item?.year);
      const genre = normalizeString(item?.genre) || 'General Interest';
      const synopsis = normalizeString(item?.synopsis || item?.description) || 'No description available yet.';
      const coverUrl = normalizeString(item?.coverUrl || item?.cover_url);
      const itemUrl = normalizeString(item?.itemUrl || item?.item_url);
      const sourceKey = normalizeString(item?.sourceKey) ||
        `internet-archive:${normalizeString(item?.identifier) || `${title}:${author || ''}`}`;
      sourceKeys.push(sourceKey);
      upsertBook.run(title, author, year, genre, synopsis, coverUrl, itemUrl, sourceKey);
    }
    pruneImportedRows('books', syncOptions.activeSourcePrefixes, sourceKeys, syncOptions.inactiveSourcePrefixes);
  });
  sync(items);
  return true;
}

function syncMovieItems(items, syncOptions = {}) {
  if (!Array.isArray(items)) return false;
  const upsertMovie = db.prepare(`
    INSERT INTO movies (title, year, genre, director, writers, cast_members, age_rating, overview, synopsis, poster_url, source_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      title = excluded.title, year = excluded.year, genre = excluded.genre,
      director = excluded.director, writers = excluded.writers,
      cast_members = excluded.cast_members, age_rating = excluded.age_rating,
      overview = excluded.overview, synopsis = excluded.synopsis,
      poster_url = excluded.poster_url
  `);
  const sync = db.transaction((records) => {
    const sourceKeys = [];
    for (const item of records) {
      const title = normalizeString(item?.title);
      if (!title) continue;
      const sourceKey = normalizeString(item?.sourceKey) ||
        `${syncOptions.defaultSourceKeyPrefix || 'tmdb:movie:'}${title}`;
      sourceKeys.push(sourceKey);
      upsertMovie.run(
        title, normalizeYear(item?.year || item?.releaseDate),
        normalizeString(item?.genre), normalizeString(item?.director),
        normalizeString(item?.writers), normalizeString(item?.cast || item?.cast_members),
        normalizeString(item?.ageRating || item?.age_rating),
        normalizeString(item?.overview || item?.synopsis) || 'No description available yet.',
        normalizeString(item?.synopsis) || 'No description available yet.',
        normalizeString(item?.posterUrl || item?.poster_url), sourceKey
      );
    }
    pruneImportedRows('movies', syncOptions.activeSourcePrefixes, sourceKeys, syncOptions.inactiveSourcePrefixes);
  });
  sync(items);
  return true;
}

function syncMoviesFromTmdb() {
  return syncJsonSeedFile(tmdbMoviesDataPath, tmdbMovieSyncState,
    (parsed) => (Array.isArray(parsed?.items) ? parsed.items : []), syncMovieItems,
    { activeSourcePrefixes: ['tmdb:movie:'], inactiveSourcePrefixes: ['plex:movie:'], defaultSourceKeyPrefix: 'tmdb:movie:' });
}

function syncMoviesFromPlex() {
  return syncJsonSeedFile(plexMoviesDataPath, plexMovieSyncState,
    (parsed) => (Array.isArray(parsed?.items) ? parsed.items : []), syncMovieItems,
    { activeSourcePrefixes: ['plex:movie:'], inactiveSourcePrefixes: ['tmdb:movie:'], defaultSourceKeyPrefix: 'plex:movie:' });
}

function syncMoviesFromTmdbBulk() {
  return syncJsonlSeedFile(tmdbMoviesBulkDataPath, tmdbMovieBulkSyncState, syncMovieItems,
    { activeSourcePrefixes: ['tmdb:movie:'], inactiveSourcePrefixes: [], defaultSourceKeyPrefix: 'tmdb:movie:' });
}

function syncMoviesFromPlexBulk() {
  return syncJsonlSeedFile(plexMoviesBulkDataPath, plexMovieBulkSyncState, syncMovieItems,
    { activeSourcePrefixes: ['plex:movie:'], inactiveSourcePrefixes: [], defaultSourceKeyPrefix: 'plex:movie:' });
}

function syncTvShowItems(items, syncOptions = {}) {
  if (!Array.isArray(items)) return false;
  const upsertShow = db.prepare(`
    INSERT INTO tv_shows (title, year, genre, creator, writers, cast_members, age_rating, overview, synopsis, poster_url, seasons, source_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      title = excluded.title, year = excluded.year, genre = excluded.genre,
      creator = excluded.creator, writers = excluded.writers,
      cast_members = excluded.cast_members, age_rating = excluded.age_rating,
      overview = excluded.overview, synopsis = excluded.synopsis,
      poster_url = excluded.poster_url, seasons = excluded.seasons
  `);
  const sync = db.transaction((records) => {
    const sourceKeys = [];
    for (const item of records) {
      const title = normalizeString(item?.title);
      if (!title) continue;
      const sourceKey = normalizeString(item?.sourceKey) ||
        `${syncOptions.defaultSourceKeyPrefix || 'tmdb:tv:'}${title}`;
      sourceKeys.push(sourceKey);
      upsertShow.run(
        title, normalizeYear(item?.year || item?.releaseDate),
        normalizeString(item?.genre), normalizeString(item?.creator),
        normalizeString(item?.writers), normalizeString(item?.cast || item?.cast_members),
        normalizeString(item?.ageRating || item?.age_rating),
        normalizeString(item?.overview || item?.synopsis) || 'No description available yet.',
        normalizeString(item?.synopsis) || 'No description available yet.',
        normalizeString(item?.posterUrl || item?.poster_url),
        Number.isFinite(Number(item?.seasons)) ? Number(item.seasons) : null,
        sourceKey
      );
    }
    pruneImportedRows('tv_shows', syncOptions.activeSourcePrefixes, sourceKeys, syncOptions.inactiveSourcePrefixes);
  });
  sync(items);
  return true;
}

function syncTvShowsFromTmdb() {
  return syncJsonSeedFile(tmdbTvDataPath, tmdbTvSyncState,
    (parsed) => (Array.isArray(parsed?.items) ? parsed.items : []), syncTvShowItems,
    { activeSourcePrefixes: ['tmdb:tv:'], inactiveSourcePrefixes: ['plex:tv:'], defaultSourceKeyPrefix: 'tmdb:tv:' });
}

function syncTvShowsFromPlex() {
  return syncJsonSeedFile(plexTvDataPath, plexTvSyncState,
    (parsed) => (Array.isArray(parsed?.items) ? parsed.items : []), syncTvShowItems,
    { activeSourcePrefixes: ['plex:tv:'], inactiveSourcePrefixes: ['tmdb:tv:'], defaultSourceKeyPrefix: 'plex:tv:' });
}

function syncTvShowsFromTmdbBulk() {
  return syncJsonlSeedFile(tmdbTvBulkDataPath, tmdbTvBulkSyncState, syncTvShowItems,
    { activeSourcePrefixes: ['tmdb:tv:'], inactiveSourcePrefixes: [], defaultSourceKeyPrefix: 'tmdb:tv:' });
}

function syncTvShowsFromPlexBulk() {
  return syncJsonlSeedFile(plexTvBulkDataPath, plexTvBulkSyncState, syncTvShowItems,
    { activeSourcePrefixes: ['plex:tv:'], inactiveSourcePrefixes: [], defaultSourceKeyPrefix: 'plex:tv:' });
}

function syncBooksFromInternetArchive() {
  return syncJsonSeedFile(internetArchiveBooksDataPath, archiveBookSyncState,
    (parsed) => Array.isArray(parsed?.books) ? parsed.books : Array.isArray(parsed?.items) ? parsed.items : [],
    syncArchiveBookItems,
    { activeSourcePrefixes: ['internet-archive:'], inactiveSourcePrefixes: ['openlibrary:'] });
}

function syncBooksFromInternetArchiveBulk() {
  return syncJsonlSeedFile(internetArchiveBooksBulkDataPath, archiveBulkSyncState, syncArchiveBookItems,
    { activeSourcePrefixes: ['internet-archive:'], inactiveSourcePrefixes: ['openlibrary:'] });
}

function syncBooksFromOpenLibrary() {
  const signature = getFileSignature(openLibraryDataPath);
  if (!signature) { resetSeedSyncState(openLibrarySyncState); return false; }
  if (openLibrarySyncState.loaded && openLibrarySyncState.signature === signature) return true;

  try {
    const parsed = JSON.parse(fs.readFileSync(openLibraryDataPath, 'utf8'));
    const docs = Array.isArray(parsed?.search?.docs) ? parsed.search.docs : [];
    const workDescriptionById = new Map();
    if (parsed?.workDetail?.workId && parsed?.workDetail?.description) {
      workDescriptionById.set(parsed.workDetail.workId, pickFirstString(parsed.workDetail.description));
    }

    const upsertBook = db.prepare(`
      INSERT INTO books (title, author, year, genre, synopsis, cover_url, source_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        title = excluded.title, author = excluded.author, year = excluded.year,
        genre = excluded.genre, synopsis = excluded.synopsis, cover_url = excluded.cover_url
    `);

    const sync = db.transaction((records) => {
      const sourceKeys = [];
      for (const doc of records) {
        const title = typeof doc?.title === 'string' ? doc.title.trim() : '';
        if (!title) continue;
        const author = Array.isArray(doc?.authors) ? doc.authors.filter(Boolean).join(', ') : '';
        const year = Number.isFinite(Number(doc?.firstPublishedYear)) ? Number(doc.firstPublishedYear) : null;
        const genre = pickBookGenre(Array.isArray(doc?.subjects) ? doc.subjects : []);
        const synopsis = extractSynopsis(doc, workDescriptionById);
        const coverUrl = typeof doc?.coverUrl === 'string' ? doc.coverUrl.trim() : null;
        const sourceKey = `openlibrary:${doc?.workId || doc?.key || `${title}:${author}`}`;
        sourceKeys.push(sourceKey);
        upsertBook.run(title, author, year, genre, synopsis, coverUrl, sourceKey);
      }
      pruneImportedRows('books', ['openlibrary:'], sourceKeys, ['internet-archive:']);
    });

    sync(docs);
    openLibrarySyncState.signature = signature;
    openLibrarySyncState.loaded = true;
    return true;
  } catch (err) {
    console.error('Unable to sync books from Open Library data file:', err);
    return false;
  }
}

function syncPreferredMovies() {
  let loaded = false;
  if (fileHasContent(tmdbMoviesBulkDataPath)) { syncMoviesFromTmdbBulk(); loaded = true; }
  else if (fileHasContent(tmdbMoviesDataPath)) { syncMoviesFromTmdb(); loaded = true; }
  if (fileHasContent(plexMoviesBulkDataPath)) { syncMoviesFromPlexBulk(); loaded = true; }
  else if (fileHasContent(plexMoviesDataPath)) { syncMoviesFromPlex(); loaded = true; }
  if (!loaded) pruneImportedRows('movies', ['plex:movie:', 'tmdb:movie:'], []);
  return loaded;
}

function syncPreferredTvShows() {
  let loaded = false;
  if (fileHasContent(tmdbTvBulkDataPath)) { syncTvShowsFromTmdbBulk(); loaded = true; }
  else if (fileHasContent(tmdbTvDataPath)) { syncTvShowsFromTmdb(); loaded = true; }
  if (fileHasContent(plexTvBulkDataPath)) { syncTvShowsFromPlexBulk(); loaded = true; }
  else if (fileHasContent(plexTvDataPath)) { syncTvShowsFromPlex(); loaded = true; }
  if (!loaded) pruneImportedRows('tv_shows', ['plex:tv:', 'tmdb:tv:'], []);
  return loaded;
}

function syncPreferredBooks() {
  if (fileHasContent(internetArchiveBooksBulkDataPath)) return syncBooksFromInternetArchiveBulk();
  if (fileHasContent(internetArchiveBooksDataPath)) return syncBooksFromInternetArchive();
  if (fileHasContent(openLibraryDataPath)) return syncBooksFromOpenLibrary();
  pruneImportedRows('books', ['internet-archive:', 'openlibrary:'], []);
  return false;
}

// ── Schema ────────────────────────────────────────────────────────────────────
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
    title TEXT NOT NULL, year INTEGER, genre TEXT, director TEXT,
    writers TEXT, cast_members TEXT, age_rating TEXT, overview TEXT,
    synopsis TEXT, poster_url TEXT, source_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tv_shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, year INTEGER, genre TEXT, creator TEXT,
    writers TEXT, cast_members TEXT, age_rating TEXT, overview TEXT,
    synopsis TEXT, poster_url TEXT, seasons INTEGER, source_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, author TEXT, year INTEGER, genre TEXT,
    synopsis TEXT, cover_url TEXT, item_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS movie_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, media_id INTEGER NOT NULL,
    acting INTEGER NOT NULL CHECK(acting >= 1 AND acting <= 5),
    writing INTEGER NOT NULL CHECK(writing >= 1 AND writing <= 5),
    originality INTEGER NOT NULL CHECK(originality >= 1 AND originality <= 5),
    pacing INTEGER NOT NULL CHECK(pacing >= 1 AND pacing <= 5),
    cinematography INTEGER NOT NULL CHECK(cinematography >= 1 AND cinematography <= 5),
    review TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE (user_id, media_id)
  );

  CREATE TABLE IF NOT EXISTS tv_show_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, media_id INTEGER NOT NULL,
    premise INTEGER NOT NULL CHECK(premise >= 1 AND premise <= 5),
    originality INTEGER NOT NULL CHECK(originality >= 1 AND originality <= 5),
    acting INTEGER NOT NULL CHECK(acting >= 1 AND acting <= 6),
    cinematography INTEGER NOT NULL CHECK(cinematography >= 1 AND cinematography <= 5),
    writing INTEGER NOT NULL CHECK(writing >= 1 AND writing <= 6),
    pacing INTEGER NOT NULL CHECK(pacing >= 1 AND pacing <= 5),
    resonance INTEGER NOT NULL CHECK(resonance >= 1 AND resonance <= 6),
    review TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE (user_id, media_id)
  );

  CREATE TABLE IF NOT EXISTS book_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, media_id INTEGER NOT NULL,
    prose INTEGER NOT NULL CHECK(prose >= 1 AND prose <= 5),
    plot INTEGER NOT NULL CHECK(plot >= 1 AND plot <= 5),
    characters INTEGER NOT NULL CHECK(characters >= 1 AND characters <= 6),
    originality INTEGER NOT NULL CHECK(originality >= 1 AND originality <= 5),
    pacing INTEGER NOT NULL CHECK(pacing >= 1 AND pacing <= 5),
    resonance INTEGER NOT NULL CHECK(resonance >= 1 AND resonance <= 6),
    review TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE (user_id, media_id)
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv_show', 'book')),
    media_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'plan_to_watch',
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE (user_id, media_type, media_id)
  );

  CREATE TABLE IF NOT EXISTS media_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, name TEXT NOT NULL,
    share_code TEXT NOT NULL UNIQUE, is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS media_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv_show', 'book')),
    media_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (list_id) REFERENCES media_lists(id) ON DELETE CASCADE,
    UNIQUE (list_id, media_type, media_id)
  );

  CREATE TABLE IF NOT EXISTS media_list_collaborators (
    id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, invited_by_user_id INTEGER NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (list_id) REFERENCES media_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (list_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS media_list_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, list_item_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, value INTEGER NOT NULL CHECK(value IN (-1, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (list_item_id) REFERENCES media_list_items(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (list_item_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, query TEXT NOT NULL, intent TEXT,
    response_length INTEGER, sources_count INTEGER, latency_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    error_type TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS media_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, title TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv_show', 'book')),
    year INTEGER, reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    admin_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS episode_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, media_id INTEGER NOT NULL,
    season INTEGER NOT NULL, episode INTEGER NOT NULL,
    watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, media_id, season, episode),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ── Column migrations ─────────────────────────────────────────────────────────
if (!hasColumn('users', 'bio'))              db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
if (!hasColumn('users', 'avatar_url'))       db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
if (!hasColumn('books', 'source_key'))       db.exec('ALTER TABLE books ADD COLUMN source_key TEXT');
if (!hasColumn('books', 'item_url'))         db.exec('ALTER TABLE books ADD COLUMN item_url TEXT');

// Watchlist progress tracking columns
if (!hasColumn('watchlist', 'current_season'))  db.exec('ALTER TABLE watchlist ADD COLUMN current_season INTEGER');
if (!hasColumn('watchlist', 'current_episode')) db.exec('ALTER TABLE watchlist ADD COLUMN current_episode INTEGER');
if (!hasColumn('watchlist', 'current_page'))    db.exec('ALTER TABLE watchlist ADD COLUMN current_page INTEGER');
if (!hasColumn('watchlist', 'current_chapter')) db.exec('ALTER TABLE watchlist ADD COLUMN current_chapter TEXT');
if (!hasColumn('watchlist', 'notes'))           db.exec('ALTER TABLE watchlist ADD COLUMN notes TEXT');
if (!hasColumn('watchlist', 'completed_at'))    db.exec('ALTER TABLE watchlist ADD COLUMN completed_at DATETIME');
if (!hasColumn('watchlist', 'updated_at'))      db.exec('ALTER TABLE watchlist ADD COLUMN updated_at DATETIME');
if (!hasColumn('movies', 'source_key'))      db.exec('ALTER TABLE movies ADD COLUMN source_key TEXT');
if (!hasColumn('movies', 'writers'))         db.exec('ALTER TABLE movies ADD COLUMN writers TEXT');
if (!hasColumn('movies', 'cast_members'))    db.exec('ALTER TABLE movies ADD COLUMN cast_members TEXT');
if (!hasColumn('movies', 'age_rating'))      db.exec('ALTER TABLE movies ADD COLUMN age_rating TEXT');
if (!hasColumn('movies', 'overview'))        db.exec('ALTER TABLE movies ADD COLUMN overview TEXT');
if (!hasColumn('tv_shows', 'source_key'))    db.exec('ALTER TABLE tv_shows ADD COLUMN source_key TEXT');
if (!hasColumn('tv_shows', 'writers'))       db.exec('ALTER TABLE tv_shows ADD COLUMN writers TEXT');
if (!hasColumn('tv_shows', 'cast_members'))  db.exec('ALTER TABLE tv_shows ADD COLUMN cast_members TEXT');
if (!hasColumn('tv_shows', 'age_rating'))    db.exec('ALTER TABLE tv_shows ADD COLUMN age_rating TEXT');
if (!hasColumn('tv_shows', 'overview'))      db.exec('ALTER TABLE tv_shows ADD COLUMN overview TEXT');

// Drop legacy ratings table if it still exists
if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ratings'").get()) {
  db.exec('DROP TABLE ratings');
}

// ── Unique indexes (required for ON CONFLICT upserts) ────────────────────────
// Must be created BEFORE any sync functions run
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_source_key_unique ON movies(source_key);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tv_shows_source_key_unique ON tv_shows(source_key);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_books_source_key_unique ON books(source_key);
`);

// ── Indexes ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_media_lists_user_id ON media_lists(user_id);
  CREATE INDEX IF NOT EXISTS idx_media_lists_share_code ON media_lists(share_code);
  CREATE INDEX IF NOT EXISTS idx_media_list_items_list_id ON media_list_items(list_id);
  CREATE INDEX IF NOT EXISTS idx_media_list_items_list_position ON media_list_items(list_id, position);
  CREATE INDEX IF NOT EXISTS idx_media_list_collaborators_list_id ON media_list_collaborators(list_id);
  CREATE INDEX IF NOT EXISTS idx_media_list_collaborators_user_id ON media_list_collaborators(user_id);
  CREATE INDEX IF NOT EXISTS idx_media_list_votes_item_id ON media_list_votes(list_item_id);
  CREATE INDEX IF NOT EXISTS idx_media_list_votes_user_id ON media_list_votes(user_id);
  CREATE INDEX IF NOT EXISTS idx_movies_title_lower ON movies(LOWER(title));
  CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year);
  CREATE INDEX IF NOT EXISTS idx_movies_genre ON movies(genre);
  CREATE INDEX IF NOT EXISTS idx_movies_source_key ON movies(source_key);
  CREATE INDEX IF NOT EXISTS idx_tv_shows_title_lower ON tv_shows(LOWER(title));
  CREATE INDEX IF NOT EXISTS idx_tv_shows_year ON tv_shows(year);
  CREATE INDEX IF NOT EXISTS idx_tv_shows_genre ON tv_shows(genre);
  CREATE INDEX IF NOT EXISTS idx_tv_shows_source_key ON tv_shows(source_key);
  CREATE INDEX IF NOT EXISTS idx_books_title_lower ON books(LOWER(title));
  CREATE INDEX IF NOT EXISTS idx_books_genre ON books(genre);
  CREATE INDEX IF NOT EXISTS idx_books_source_key ON books(source_key);
`);

syncPreferredMovies();
syncPreferredTvShows();
syncPreferredBooks();

db.syncImportedMovies = () => { syncPreferredMovies(); };
db.syncImportedTvShows = () => { syncPreferredTvShows(); };
db.syncImportedBooks = () => { syncPreferredBooks(); };

module.exports = db;
