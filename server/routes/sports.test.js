const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// The API function loads every route at startup. The sports feed module (shared
// with the browser) is loaded on first use instead, so a problem loading it can
// only break the sports fallback, never every /api route. On 2026-11-06, with it
// loaded at startup as an .mjs, every /api route on Vercel returned 500.
test('starting the API doesn’t load the sports feed module', () => {
  require('../app');
  const feedsFile = path.join('src', 'utils', 'sportsFeeds.js');
  const loaded = Object.keys(require.cache).some((file) => file.endsWith(feedsFile));
  assert.equal(loaded, false);
});

test('the sports feed module loads in the server', () => {
  const feeds = require('../../src/utils/sportsFeeds');
  assert.equal(typeof feeds.fetchPpvNormalized, 'function');
  assert.equal(typeof feeds.fetchStreamedNormalized, 'function');
  assert.equal(typeof feeds.fetchStreamfreeNormalized, 'function');
});
