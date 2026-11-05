// Catalog search against a real (in-memory) libSQL database with the Turso
// schema, covering what Neon's search_catalog() did.
process.env.TURSO_DATABASE_URL = 'file::memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalogDb = require('../catalogDb');
const { applySchema } = require('../catalogSchema');
const { searchCatalog, searchNorm, similarity, wordSimilarity } = require('../catalogSearch');
const { executeQuery } = require('./query');

const NOW = new Date('2026-11-04T12:00:00Z');
const movies = [
  { title: 'Amélie', year: 2001, source_key: 'tmdb:movie:194', popularity: 20, poster_url: 'p' },
  { title: 'Léon: The Professional', year: 1994, source_key: 'tmdb:movie:101', popularity: 30, poster_url: 'p' },
  { title: 'Office Space', year: 1999, source_key: 'tmdb:movie:1542', popularity: 15, poster_url: 'p' },
  { title: 'X-Men: Days of Future Past', year: 2014, source_key: 'tmdb:movie:127585', popularity: 25, poster_url: 'p' },
  { title: "Harry Potter and the Philosopher's Stone", year: 2001, source_key: 'tmdb:movie:671', popularity: 90, poster_url: 'p' },
  { title: 'WALL·E', year: 2008, source_key: 'tmdb:movie:10681', popularity: 40, poster_url: 'p' },
  { title: 'Up', year: 2009, source_key: 'tmdb:movie:14160', popularity: 50, poster_url: 'p' },
  { title: 'Upgrade', year: 2018, source_key: 'tmdb:movie:500664', popularity: 10, poster_url: 'p' },
  { title: 'Up Far Away', year: 2027, release_date: '2027-06-01', source_key: 'tmdb:movie:1', popularity: 99 },
  { title: 'Up Unlisted', year: 2009, source_key: null, popularity: 99 },
];
const shows = [
  { title: 'The Office', year: 2005, source_key: 'tmdb:tv:2316', popularity: 80, poster_url: 'p' },
  { title: 'Breaking Bad', year: 2008, source_key: 'tmdb:tv:1396', popularity: 120, poster_url: 'p' },
  { title: 'Stranger Things', year: 2016, source_key: 'tmdb:tv:66732', popularity: 150, poster_url: 'p' },
];
const books = [
  { title: 'One Hundred Years of Solitude', author: 'Gabriel García Márquez', year: 1967, source_key: 'ol:works/OL274505W', cover_url: 'c' },
];

test.before(async () => {
  await applySchema(catalogDb.getClient());
  for (const [table, values] of [['movies', movies], ['tv_shows', shows], ['books', books]]) {
    const result = await executeQuery({ table, operation: 'insert', values }, { trusted: true });
    assert.equal(result.error, null);
  }
});

const top = async (q, type) => (await searchCatalog(q, 24, { now: NOW })).filter((r) => r.result_type === type).sort((a, b) => b.score - a.score);

test('normalized like Neon: case, accents, punctuation', () => {
  assert.equal(searchNorm('Léon: The Professional'), 'leon the professional');
  assert.equal(searchNorm('Spider-Man: No Way Home'), 'spider man no way home');
  assert.equal(searchNorm('Straße'), 'strasse');
  assert.equal(searchNorm('മഞ്ഞുമ്മൽ ബോയ്സ്'), 'മഞ്ഞുമ്മൽ ബോയ്സ്');
});

test('pg_trgm scores match Postgres', () => {
  // Values from Neon: select similarity(a,b), word_similarity(a,b)
  assert.ok(Math.abs(similarity('word', 'two words') - 0.363636) < 1e-5);
  assert.equal(wordSimilarity('word', 'two words'), 0.8);
  assert.ok(Math.abs(wordSimilarity('harry poter', 'harry potter and the philosopher s stone') - 0.785714) < 1e-5);
  assert.equal(similarity('brekaing bad', 'breaking bad'), 0.5);
});

test('accents and punctuation do not matter', async () => {
  assert.equal((await top('amelie', 'movie'))[0].title, 'Amélie');
  assert.equal((await top('leon the professional', 'movie'))[0].title, 'Léon: The Professional');
  assert.equal((await top('walle', 'movie'))[0].title, 'WALL·E');
});

test('squashed and article-less queries', async () => {
  assert.equal((await top('xmen', 'movie'))[0].title, 'X-Men: Days of Future Past');
  const office = await top('office', 'tv');
  assert.equal(office[0].title, 'The Office');
  assert.ok(office[0].score > 1, 'counts as an exact match once "the" is dropped');
});

test('short queries match by prefix and skip unreleased or unlisted titles', async () => {
  const up = await top('up', 'movie');
  assert.deepEqual(up.map((r) => r.title), ['Up', 'Upgrade']);
});

test('typos fall back to trigram and word similarity', async () => {
  assert.equal((await top('brekaing bad', 'tv'))[0].title, 'Breaking Bad');
  assert.equal((await top('stranger thigns', 'tv'))[0].title, 'Stranger Things');
  assert.equal((await top('harry poter', 'movie'))[0].title, "Harry Potter and the Philosopher's Stone");
});

test('books are found by author', async () => {
  const found = await top('garcia marquez', 'book');
  assert.equal(found[0].title, 'One Hundred Years of Solitude');
  assert.equal(found[0].poster_url, 'c');
});

test('search columns stay in step with title changes', async () => {
  await executeQuery({ table: 'movies', operation: 'update', values: { title: 'Amélie Poulain' }, filters: [{ column: 'source_key', operator: 'eq', value: 'tmdb:movie:194' }] }, { trusted: true });
  assert.equal((await top('poulain', 'movie'))[0].title, 'Amélie Poulain');
  const rows = (await executeQuery({ table: 'movies', columns: '*', filters: [{ column: 'source_key', operator: 'eq', value: 'tmdb:movie:194' }] })).data;
  assert.equal(Object.keys(rows[0]).some((k) => k.startsWith('search_')), false, 'helper columns are not returned');
});
