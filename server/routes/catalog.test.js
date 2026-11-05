const test = require('node:test');
const assert = require('node:assert/strict');

// /api/catalog is the catalog's name; /api/neon-data is the old one, still
// requested by installed TV builds. Both must reach the same router.
test('the catalog answers at /api/catalog and at its old path', async (t) => {
  const app = require('../app');
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of ['/api/catalog', '/api/neon-data']) {
    // A user table is refused before any database is touched.
    const response = await fetch(`${base}${path}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'profiles', operation: 'select' }),
    });
    assert.equal(response.status, 400, path);
    const body = await response.json();
    assert.ok(body.error, `${path} should explain the refusal`);
  }
});
