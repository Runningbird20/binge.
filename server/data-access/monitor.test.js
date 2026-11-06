const test = require('node:test');
const assert = require('node:assert/strict');
const { watchCatalog, SLOW_MS, QUIET_MS, _reset } = require('./monitor');

const req = { method: 'GET', originalUrl: '/api/catalog/rest/movies', headers: {} };
// A clock the test moves: each request "takes" `ms`.
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

test('a database failure is logged, once per 10 minutes', async () => {
  _reset();
  const logged = [];
  const time = clock();
  const run = async () => ({ data: null, error: { message: 'SERVER_ERROR: token expired', code: 'SERVER_ERROR' } });
  const options = { log: (entry) => logged.push(entry), now: time.now };
  await watchCatalog(req, 'select movies', run, options);
  await watchCatalog(req, 'select movies', run, options);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].message, 'Catalog error: SERVER_ERROR: token expired');
  assert.match(logged[0].stack, /select movies/);
  time.advance(QUIET_MS);
  await watchCatalog(req, 'select movies', run, options);
  assert.equal(logged.length, 2);
});

test('mistakes in the request itself aren’t the catalog’s, and aren’t logged', async () => {
  _reset();
  const logged = [];
  const options = { log: (entry) => logged.push(entry), now: clock().now };
  for (const error of [
    { message: 'Table is not accessible', code: 'CATALOG_QUERY_ERROR' },
    { message: 'Media tables are read-only through this endpoint', code: 'CATALOG_QUERY_ERROR' },
    { message: 'Expected one row', code: 'PGRST116' },
  ]) {
    const result = await watchCatalog(req, 'select profiles', async () => ({ data: null, error }), options);
    assert.deepEqual(result.error, error); // the answer itself is unchanged
  }
  assert.equal(logged.length, 0);
});

test('a slow query is logged with its time; a quick one isn’t', async () => {
  _reset();
  const logged = [];
  const time = clock();
  const options = { log: (entry) => logged.push(entry), now: time.now };
  await watchCatalog(req, 'select movies', async () => { time.advance(300); return { data: [], error: null }; }, options);
  assert.equal(logged.length, 0);
  await watchCatalog(req, 'rpc search_catalog', async () => { time.advance(SLOW_MS + 2200); return { data: [], error: null }; }, options);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].message, 'Slow catalog query: rpc search_catalog (over 2s)');
  assert.match(logged[0].stack, /4\.2s/);
});

test('outside production it only prints, so previews and local runs stay out of the shared log', async () => {
  _reset();
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'preview';
  const warn = console.warn;
  const printed = [];
  console.warn = (line) => printed.push(line);
  try {
    await watchCatalog(req, 'select movies', async () => ({ data: null, error: { message: 'fetch failed' } }), { now: clock().now });
  } finally {
    console.warn = warn;
    if (previous === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previous;
  }
  assert.equal(printed.length, 1);
  assert.match(printed[0], /Catalog error: fetch failed/);
});
