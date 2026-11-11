// Search's "related" row: titles whose description mentions the words typed
// (search_related, called by supabaseApi.js handleSearchRelated).
//
// No index can answer `overview LIKE '%words%'`, so asking the whole table
// read every row: ~15s for one search on the movies table (2026-11-10, the
// "Slow catalog query" errors in /admin), and Turso bills each row read. So
// each table is searched within a bounded window that an index hands over in
// order: the most popular movies and series (the partial popularity indexes)
// and the newest books (books_year; the row was sorted newest-first anyway).
// One read round trip for all three.
const catalogDb = require('./catalogDb');
const { searchNorm } = require('./catalogSearch');

const WINDOW = 5000;
const LIMIT = 8;

const TABLES = {
  movies: {
    sql: `SELECT id, title, year, genre, poster_url, source_key, external_id FROM (
      SELECT id, title, year, genre, poster_url, source_key, external_id, vote_average, overview, synopsis
      FROM movies WHERE poster_url IS NOT NULL ORDER BY popularity DESC LIMIT ?2
    ) WHERE source_key IS NOT NULL AND (overview LIKE ?1 OR synopsis LIKE ?1)
    ORDER BY vote_average DESC NULLS LAST LIMIT ?3`,
  },
  tv: {
    sql: `SELECT id, title, year, genre, poster_url, source_key, external_id FROM (
      SELECT id, title, year, genre, poster_url, source_key, external_id, overview, synopsis
      FROM tv_shows WHERE poster_url IS NOT NULL ORDER BY popularity DESC LIMIT ?2
    ) WHERE source_key IS NOT NULL AND (overview LIKE ?1 OR synopsis LIKE ?1)
    ORDER BY year DESC NULLS LAST LIMIT ?3`,
  },
  books: {
    sql: `SELECT id, title, author, year, genre, cover_url, source_key, external_id FROM (
      SELECT id, title, author, year, genre, cover_url, source_key, external_id, synopsis
      FROM books WHERE year IS NOT NULL ORDER BY year DESC LIMIT ?2
    ) WHERE source_key IS NOT NULL AND synopsis LIKE ?1
    ORDER BY year DESC LIMIT ?3`,
  },
};

// "Breaking Bad's" -> "%breaking%bad%": the words in order, anything between.
// searchNorm leaves only letters, digits and spaces, so nothing typed can act
// as a LIKE wildcard.
function relatedPattern(q) {
  const words = (searchNorm(String(q || '').slice(0, 200)) || '').split(' ').filter((w) => w.length >= 2);
  return words.length ? `%${words.join('%')}%` : null;
}

async function searchRelated(q, types = ['movies', 'tv', 'books']) {
  const empty = { movies: [], tv: [], books: [] };
  const pattern = relatedPattern(q);
  const kinds = types.filter((t) => TABLES[t]);
  if (!pattern || !kinds.length) return empty;
  const results = await catalogDb.batch(kinds.map((kind) => ({ sql: TABLES[kind].sql, params: [pattern, WINDOW, LIMIT] })), 'read');
  kinds.forEach((kind, i) => { empty[kind] = results[i].rows; });
  return empty;
}

module.exports = { searchRelated, relatedPattern, TABLES, WINDOW };
