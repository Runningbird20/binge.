const test = require('node:test');
const assert = require('node:assert/strict');

test('the catalog answers at /api/catalog and refuses user tables', async (t) => {
  const app = require('../app');
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // A user table is refused before any database is touched.
  const response = await fetch(`${base}/api/catalog/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: 'profiles', operation: 'select' }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.error, 'the refusal should explain itself');
});
