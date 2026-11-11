// Search's description matches (server/catalogRelated.js) against an in-memory
// libSQL database with the Turso schema: the results, and that each table is
// read through an index window, never scanned whole.
process.env.TURSO_DATABASE_URL = 'file::memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalogDb = require('../catalogDb');
const { applySchema } = require('../catalogSchema');
const { searchRelated, relatedPattern, TABLES } = require('../catalogRelated');
const { rpc } = require('./client');
const { executeQuery } = require('./query');

const movies = [
  { title: 'Heat', overview: 'A crew of thieves plans one last heist in Los Angeles.', vote_average: 8.3, popularity: 40, poster_url: 'p', source_key: 'tmdb:movie:949' },
  { title: 'Inside Man', synopsis: 'A bank HEIST turns into a hostage standoff.', vote_average: 7.6, popularity: 30, poster_url: 'p', source_key: 'tmdb:movie:388' },
  { title: 'No Poster', overview: 'Another heist.', vote_average: 9, popularity: 99, source_key: 'tmdb:movie:1' },
  { title: 'Unlisted', overview: 'A heist.', vote_average: 9, popularity: 99, poster_url: 'p', source_key: null },
  { title: 'Up', overview: 'A balloon house.', vote_average: 8, popularity: 50, poster_url: 'p', source_key: 'tmdb:movie:14160' },
];
const shows = [
  { title: 'Breaking Bad', overview: 'A chemistry teacher turns to making meth.', year: 2008, popularity: 120, poster_url: 'p', source_key: 'tmdb:tv:1396' },
  { title: 'Better Call Saul', overview: 'A lawyer, years before Breaking Bad.', year: 2015, popularity: 90, poster_url: 'p', source_key: 'tmdb:tv:60059' },
];
const books = [
  { title: 'Old Heist', synopsis: 'A heist in 1920.', year: 1920, source_key: 'ol:a' },
  { title: 'New Heist', synopsis: 'A heist in 2020.', year: 2020, source_key: 'ol:b' },
  { title: 'Undated Heist', synopsis: 'A heist.', source_key: 'ol:c' },
];

test.before(async () => {
  await applySchema(catalogDb.getClient());
  for (const [table, values] of [['movies', movies], ['tv_shows', shows], ['books', books]]) {
    const result = await executeQuery({ table, operation: 'insert', values }, { trusted: true });
    assert.equal(result.error, null);
  }
});

test('the words typed become one LIKE pattern, with nothing that acts as a wildcard', () => {
  assert.equal(relatedPattern("Breaking Bad's"), '%breaking%bad%');
  assert.equal(relatedPattern('100%_off'), '%100%off%');
  assert.equal(relatedPattern('a'), null);
});

test('finds description matches, best rated first, only listed titles with posters', async () => {
  const { movies: found } = await searchRelated('heist', ['movies']);
  assert.deepEqual(found.map((r) => r.title), ['Heat', 'Inside Man']);
  assert.equal(found[0].overview, undefined); // the description isn't sent back
});

test('series newest first, books newest first and dated only', async () => {
  const result = await searchRelated('breaking bad', ['tv', 'books']);
  assert.deepEqual(result.tv.map((r) => r.title), ['Better Call Saul']);
  assert.deepEqual(result.movies, []);
  const { books: found } = await searchRelated('heist', ['books']);
  assert.deepEqual(found.map((r) => r.title), ['New Heist', 'Old Heist']);
});

test('each table is read through an index, never scanned whole', async () => {
  for (const [kind, { sql }] of Object.entries(TABLES)) {
    const { rows } = await catalogDb.query(`EXPLAIN QUERY PLAN ${sql}`, ['%x%', 5000, 8]);
    const plan = rows.map((r) => r.detail).join('; ');
    assert.match(plan, /USING INDEX (movies_popularity|tv_shows_popularity|books_year)/, `${kind}: ${plan}`);
    assert.doesNotMatch(plan, /SCAN (movies|tv_shows|books)(?! USING)/, `${kind}: ${plan}`);
  }
});

test('the catalog rpc answers search_related and refuses other arguments', async () => {
  const { data, error } = await rpc('search_related', { q: 'heist', types: 'movies' });
  assert.equal(error, null);
  assert.deepEqual(data.movies.map((r) => r.title), ['Heat', 'Inside Man']);
  assert.equal((await rpc('search_related', { q: 'heist', sql: 'x' })).error.message, 'Unsupported search argument');
});
