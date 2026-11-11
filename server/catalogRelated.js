// Search's "related" row: titles whose description mentions the words typed
// (search_related, called by supabaseApi.js handleSearchRelated).
//
// Asking the tables for `overview LIKE '%words%'` read every row's text
// (~15s a search, up to 112s with a cold cache, and Turso bills each row: the
// "Slow catalog query" errors of 2026-11-10). Now:
//   - the words are looked up in the description word index (schema.sql
//     *_text_fts), which reads only the index;
//   - within a window an index hands over in order (the 10,000 most popular
//     movies/series, the 10,000 newest books), so common words stay bounded
//     and the row keeps to titles people know;
//   - only the matching rows are read. One round trip for all three.
// Measured on Turso (2026-11-11): 10–26k rows read, ~0.5–1.7s cold, ~30ms warm.
const catalogDb = require('./catalogDb');
const { searchNorm } = require('./catalogSearch');

const WINDOW = 10000;
const LIMIT = 8;

const related = ({ table, columns, window, order }) => `SELECT ${columns.map((c) => `m.${c}`).join(', ')}
  FROM (SELECT id FROM ${table} WHERE ${window} LIMIT ?2) w
  CROSS JOIN ${table} m ON m.id = w.id
  WHERE w.id IN (SELECT rowid FROM ${table}_text_fts WHERE ${table}_text_fts MATCH ?1)
    AND m.source_key IS NOT NULL
  ORDER BY ${order} LIMIT ?3`;

const TABLES = {
  movies: {
    sql: related({ table: 'movies', columns: ['id', 'title', 'year', 'genre', 'poster_url', 'source_key', 'external_id'],
      window: 'poster_url IS NOT NULL ORDER BY popularity DESC', order: 'm.vote_average DESC NULLS LAST' }),
  },
  tv: {
    sql: related({ table: 'tv_shows', columns: ['id', 'title', 'year', 'genre', 'poster_url', 'source_key', 'external_id'],
      window: 'poster_url IS NOT NULL ORDER BY popularity DESC', order: 'm.year DESC NULLS LAST' }),
  },
  books: {
    sql: related({ table: 'books', columns: ['id', 'title', 'author', 'year', 'genre', 'cover_url', 'source_key', 'external_id'],
      window: 'year IS NOT NULL ORDER BY year DESC', order: 'm.year DESC' }),
  },
};

// Words in nearly every description say nothing about it, and their index
// lists are the long ones ("the" took 4s the first time).
const FILLER = new Set(['the', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'at', 'by', 'from', 'is', 'it', 'its',
  'his', 'her', 'he', 'she', 'they', 'their', 'as', 'be', 'this', 'that', 'who', 'into', 'but', 'are', 'was', 'when', 'after']);

// "Breaking Bad's" -> '"breaking" "bad"': every word must be in the
// description (any order). searchNorm leaves only letters, digits and
// spaces, so nothing typed can act as FTS syntax.
function relatedMatch(q) {
  const words = (searchNorm(String(q || '').slice(0, 200)) || '').split(' ')
    .filter((w) => w.length >= 2 && !FILLER.has(w)).slice(0, 8);
  return words.length ? words.map((w) => `"${w}"`).join(' ') : null;
}

async function searchRelated(q, types = ['movies', 'tv', 'books']) {
  const empty = { movies: [], tv: [], books: [] };
  const pattern = relatedMatch(q);
  const kinds = types.filter((t) => TABLES[t]);
  if (!pattern || !kinds.length) return empty;
  const results = await catalogDb.batch(kinds.map((kind) => ({ sql: TABLES[kind].sql, params: [pattern, WINDOW, LIMIT] })), 'read');
  kinds.forEach((kind, i) => { empty[kind] = results[i].rows; });
  return empty;
}

module.exports = { searchRelated, relatedMatch, TABLES, WINDOW };
