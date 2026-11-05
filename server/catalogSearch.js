// Catalog search on Turso, ported from Neon's search_catalog() (git history:
// neon/search_catalog.sql). Same behaviour:
//   - titles/authors compared normalized: lowercase, accents removed,
//     punctuation -> spaces ("amelie" finds Amélie, "garcia marquez" finds
//     García Márquez); a squashed form catches "xmen" / "walle"; a leading
//     the/a/an is ignored when comparing ("office" ranks The Office as exact)
//   - pass 1: exact / prefix / substring; pass 2 (only when pass 1 finds < 6):
//     typos by pg_trgm similarity (>= 0.45) and word similarity (>= 0.6)
//   - the same score formula, so results rank as they did
//
// SQLite has no unaccent or pg_trgm, so normalized text is stored in search_*
// columns when rows are written (searchColumns, called by every writer) and
// trigram FTS5 tables find substring and typo candidates; scoring runs here.
// Turso bills rows read: candidates are capped and fetched by id.
const catalogDb = require('./catalogDb');

const FOLD = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', ł: 'l', þ: 'th', ı: 'i', ħ: 'h', ŧ: 't' };

// Lowercase, accents removed, anything but letters/digits (any script) -> one
// space. Marks that aren't Latin accents (Indic vowel signs) stay in words.
function searchNorm(text) {
  if (text === null || text === undefined) return null;
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .replace(/[ßæœøđðłþıħŧ]/g, (c) => FOLD[c])
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
}

const squash = (norm) => (norm === null ? null : norm.replace(/ /g, ''));
const dropArticle = (norm) => norm.replace(/^(the|a|an) /, '');

// The search_* columns for a row being written to movies / tv_shows / books.
// Only fills what the row carries (a partial update without a title keeps the
// stored values).
function searchColumns(table, row) {
  const out = {};
  if ('title' in row) {
    out.search_norm = searchNorm(row.title);
    if (table !== 'books') out.search_squash = squash(out.search_norm);
  }
  if (table === 'books' && 'author' in row) out.search_author = searchNorm(row.author);
  return out;
}

const SEARCHABLE = new Set(['movies', 'tv_shows', 'books']);
const withSearchColumns = (table, row) => (SEARCHABLE.has(table) ? { ...row, ...searchColumns(table, row) } : row);

// --- pg_trgm, ported (contrib/pg_trgm/trgm_op.c) ----------------------------
// Trigrams of each word padded as "  word ", like generate_trgm_only.
function trigramList(text) {
  const list = [];
  for (const word of String(text || '').split(/[^\p{L}\p{N}\p{M}]+/u)) {
    if (!word) continue;
    const chars = Array.from(`  ${word} `);
    for (let i = 0; i + 3 <= chars.length; i += 1) list.push(chars[i] + chars[i + 1] + chars[i + 2]);
  }
  return list;
}

function similarity(a, b) {
  const A = new Set(trigramList(a));
  const B = new Set(trigramList(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common += 1;
  return common / (A.size + B.size - common);
}

// word_similarity(q, text): the best similarity between q's trigrams and a
// continuous stretch of text's trigrams (iterate_word_similarity, non-strict).
function wordSimilarity(q, text) {
  const trg1 = new Set(trigramList(q));
  const trg2 = trigramList(text);
  if (!trg1.size || !trg2.length) return 0;
  const index = new Map();
  const found = [];
  const trg2indexes = trg2.map((t) => {
    if (!index.has(t)) { index.set(t, index.size); found.push(trg1.has(t)); }
    return index.get(t);
  });
  const ulen1 = trg1.size;
  const calc = (count, len2) => count / (ulen1 + len2 - count);
  const lastpos = new Array(index.size).fill(-1);
  let lower = -1; let count = 0; let ulen2 = 0; let max = 0;
  for (let i = 0; i < trg2.length; i += 1) {
    const t = trg2indexes[i];
    if (lower >= 0 || found[t]) {
      if (lastpos[t] < 0) { ulen2 += 1; if (found[t]) count += 1; }
      lastpos[t] = i;
    }
    if (!found[t]) continue;
    const upper = i;
    if (lower === -1) { lower = i; ulen2 = 1; }
    let cur = calc(count, ulen2);
    let tmpCount = count; let tmpUlen2 = ulen2; const prevLower = lower;
    for (let tmpLower = lower; tmpLower <= upper; tmpLower += 1) {
      const tmp = calc(tmpCount, tmpUlen2);
      if (tmp > cur) { cur = tmp; ulen2 = tmpUlen2; lower = tmpLower; count = tmpCount; }
      const ti = trg2indexes[tmpLower];
      if (lastpos[ti] === tmpLower) { tmpUlen2 -= 1; if (found[ti]) tmpCount -= 1; }
    }
    max = Math.max(max, cur);
    for (let tmpLower = prevLower; tmpLower < lower; tmpLower += 1) {
      const ti = trg2indexes[tmpLower];
      if (lastpos[ti] === tmpLower) lastpos[ti] = -1;
    }
  }
  return max;
}

const SIMILARITY_THRESHOLD = 0.45;
const WORD_SIMILARITY_THRESHOLD = 0.6;

// --- Query ------------------------------------------------------------------
const MAX = '\u{10FFFF}';
// Substring candidates per table and pass. A very common substring ("love")
// matches thousands of titles; exact and prefix matches are fetched
// separately, so the cap only trims substring-only matches.
const SUBSTRING_CAP = 2000;
const TYPO_CAP = 300;
const phrase = (text) => `"${text.replace(/"/g, '""')}"`;

const KINDS = [
  {
    type: 'movie', table: 'movies', fts: 'movies_fts', squashed: true,
    columns: 'id, title, year, genre, poster_url, NULL AS author, source_key, release_date, original_language, popularity, vote_average, search_norm AS sn, NULL AS sa',
    filter: "source_key IS NOT NULL AND coalesce(release_date, '0000') <= :cutoff AND coalesce(year, 0) <= :maxYear + 1",
  },
  {
    type: 'tv', table: 'tv_shows', fts: 'tv_shows_fts', squashed: true,
    columns: 'id, title, year, genre, poster_url, NULL AS author, source_key, release_date, original_language, popularity, vote_average, search_norm AS sn, NULL AS sa',
    filter: 'source_key IS NOT NULL AND coalesce(year, 0) <= :maxYear',
  },
  {
    type: 'book', table: 'books', fts: 'books_fts', squashed: false,
    columns: 'id, title, year, genre, cover_url AS poster_url, author, source_key, NULL AS release_date, NULL AS original_language, NULL AS popularity, NULL AS vote_average, search_norm AS sn, search_author AS sa',
    filter: 'source_key IS NOT NULL',
  },
];

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

// Pass 1 candidates: the same rows Neon's LIKE conditions matched.
function substringStatements(kind, { qn, qc, qs }, args) {
  const stmts = [];
  const prefixRange = (column, value) => ({
    sql: `SELECT ${kind.columns} FROM ${kind.table} WHERE ${column} >= :lo AND ${column} < :hi AND ${kind.filter}`,
    args: { ...args, lo: value, hi: value + MAX },
  });
  const terms = [];
  // norm LIKE contains (substring from 4 characters, else prefix)
  if (qn.length >= 4) terms.push(`search_norm : ${phrase(qn)}`);
  else stmts.push(prefixRange('search_norm', qn));
  // norm LIKE '%core%' when the query starts with an article
  if (qc !== qn) {
    if (qc.length >= 3) terms.push(`search_norm : ${phrase(qc)}`);
    else for (const article of ['', 'the ', 'a ', 'an ']) stmts.push(prefixRange('search_norm', article + qc));
  }
  if (kind.squashed && qs.length >= 4) terms.push(`search_squash : ${phrase(qs)}`);
  if (kind.table === 'books') {
    if (qn.length >= 4) terms.push(`search_author : ${phrase(qn)}`);
    else stmts.push(prefixRange('search_author', qn));
  }
  // Exact and prefix matches always make it in, whatever the substring cap.
  if (qn.length >= 4) stmts.push(prefixRange('search_norm', qn));
  if (qc !== qn && qc.length >= 3) for (const article of ['the ', 'a ', 'an ']) stmts.push(prefixRange('search_norm', article + qc));
  if (kind.squashed && qs.length >= 4) stmts.push(prefixRange('search_squash', qs));
  if (terms.length) {
    stmts.push({
      sql: `SELECT ${kind.columns} FROM ${kind.table} WHERE id IN (SELECT rowid FROM ${kind.fts} WHERE ${kind.fts} MATCH :match LIMIT ${SUBSTRING_CAP}) AND ${kind.filter}`,
      args: { ...args, match: terms.join(' OR ') },
    });
  }
  return stmts;
}

// Pass 2 candidates: titles sharing the most trigrams with the query.
function typoStatement(kind, qn, args) {
  const grams = new Set();
  for (const word of qn.split(' ')) {
    const chars = Array.from(word);
    for (let i = 0; i + 3 <= chars.length; i += 1) grams.add(chars.slice(i, i + 3).join(''));
  }
  if (!grams.size) return null;
  const columns = kind.table === 'books' ? '{search_norm search_author}' : 'search_norm';
  return {
    sql: `SELECT ${kind.columns} FROM ${kind.table} WHERE id IN (SELECT rowid FROM ${kind.fts} WHERE ${kind.fts} MATCH :match ORDER BY rank LIMIT ${TYPO_CAP}) AND ${kind.filter}`,
    args: { ...args, match: `${columns} : (${[...grams].map(phrase).join(' OR ')})` },
  };
}

const popularityBoost = (row) => Math.log(1 + (Number(row.popularity) || 0)) * 0.06;

function substringScore(kind, row, { qn, qc, qs }) {
  const norm = row.sn || '';
  const core = dropArticle(norm);
  const squashed = norm.replace(/ /g, '');
  let bonus = 0.15;
  if (norm === qn || squashed === qs) bonus = 1.0;
  else if (core === qc) bonus = 0.85;
  else if (norm.startsWith(qn) || core.startsWith(qc) || squashed.startsWith(qs)) bonus = 0.45;
  if (kind.type === 'book') return Math.max(similarity(core, qc), similarity(row.sa || '', qn)) + bonus;
  return similarity(core, qc) + bonus + popularityBoost(row);
}

function typoScore(kind, row, qn) {
  const norm = row.sn || '';
  const sim = similarity(norm, qn);
  const wsim = wordSimilarity(qn, norm);
  const asim = kind.type === 'book' ? wordSimilarity(qn, row.sa || '') : 0;
  if (sim < SIMILARITY_THRESHOLD && wsim < WORD_SIMILARITY_THRESHOLD && asim < WORD_SIMILARITY_THRESHOLD) return null;
  if (kind.type === 'book') return Math.max(sim, wsim, asim);
  return Math.max(sim, wsim) + popularityBoost(row);
}

function toResult(kind, row, score) {
  return {
    result_type: kind.type,
    id: row.id,
    title: row.title,
    year: row.year,
    genre: row.genre,
    poster_url: row.poster_url,
    author: row.author,
    source_key: row.source_key,
    release_date: row.release_date,
    original_language: row.original_language,
    popularity: row.popularity,
    vote_average: row.vote_average,
    score: Math.fround(score),
  };
}

function rank(kind, rows, scoreRow, n) {
  const best = new Map();
  for (const row of rows) {
    if (best.has(row.id)) continue;
    const score = scoreRow(row);
    if (score !== null) best.set(row.id, toResult(kind, row, score));
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, n);
}

async function runBatch(groups) {
  const flat = groups.flat();
  if (!flat.length) return groups.map(() => []);
  const client = catalogDb.getClient();
  if (!client) throw new Error('Catalog database is not configured (missing TURSO_DATABASE_URL).');
  // Turso rejects named arguments a statement doesn't use (local SQLite
  // ignores them), so each statement only gets the ones it references.
  const used = (sql, args) => Object.fromEntries(Object.entries(args).filter(([name]) => new RegExp(`:${name}\\b`).test(sql)));
  const statements = flat.map(({ sql, args }) => ({ sql, args: used(sql, args) }));
  const started = Date.now();
  const results = await client.batch(statements, 'read');
  if (process.env.CATALOG_DEBUG) for (const s of statements) await catalogDb.debugLog(s.sql, s.args, Date.now() - started);
  const toObjects = (result) => result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c, row[i]])));
  let at = 0;
  return groups.map((group) => {
    const rows = results.slice(at, at + group.length).flatMap(toObjects);
    at += group.length;
    return rows;
  });
}

// Same contract as Neon's search_catalog(q, lim): up to lim results per type,
// pass 2 rows may repeat a pass 1 id (the client keeps the higher score).
async function searchCatalog(q, lim = 24, { now = new Date() } = {}) {
  const qn = searchNorm(q || '') || '';
  if (Array.from(qn).length < 2) return [];
  const query = { qn, qc: dropArticle(qn), qs: qn.replace(/ /g, '') };
  const n = Math.min(Math.max(Number(lim) || 24, 1), 60);
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() + 30);
  const args = { cutoff: isoDate(cutoff), maxYear: now.getUTCFullYear() };

  const pass1 = await runBatch(KINDS.map((kind) => substringStatements(kind, query, args)));
  const results = KINDS.flatMap((kind, i) => rank(kind, pass1[i], (row) => substringScore(kind, row, query), n));
  if (results.length >= 6) return results;

  const typo = KINDS.map((kind) => [typoStatement(kind, qn, args)].filter(Boolean));
  const pass2 = await runBatch(typo);
  return results.concat(KINDS.flatMap((kind, i) => rank(kind, pass2[i], (row) => typoScore(kind, row, qn), n)));
}

module.exports = {
  searchNorm,
  searchColumns,
  withSearchColumns,
  similarity,
  wordSimilarity,
  searchCatalog,
  SEARCHABLE,
};
