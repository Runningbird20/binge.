import { api } from './api';

function mockResponse({ ok = true, status = 200, body = '', contentType = 'application/json' }) {
  return {
    ok,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: jest.fn().mockResolvedValue(body),
  };
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

test('parses successful JSON responses', async () => {
  global.fetch.mockResolvedValue(
    mockResponse({
      body: JSON.stringify({ token: 'abc123' }),
    })
  );

  await expect(api.post('/auth/login', { email: 'user@example.com' })).resolves.toEqual({
    token: 'abc123',
  });
});

test('throws a readable proxy error for non-JSON proxy responses', async () => {
  global.fetch.mockResolvedValue(
    mockResponse({
      ok: false,
      status: 500,
      body: 'Proxy error: Could not proxy request /api/auth/signup from localhost:3000 to http://localhost:5001.',
      contentType: 'text/plain',
    })
  );

  await expect(api.post('/auth/signup', { username: 'mediafan' })).rejects.toThrow(
    /make sure the api server is running and reachable/i
  );
});

test('throws a readable error when the backend cannot be reached', async () => {
  global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

  await expect(api.get('/watchlist')).rejects.toThrow(
    /couldn’t reach binge\. just now/i
  );
  // A GET is retried once before giving up.
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('throws a readable error when a successful API request returns HTML', async () => {
  global.fetch.mockResolvedValue(
    mockResponse({
      body: '<!doctype html><html><body>Not JSON</body></html>',
      contentType: 'text/html; charset=utf-8',
    })
  );

  await expect(api.get('/dev-lab/dashboard')).rejects.toThrow(
    /returned html instead of json/i
  );
});

test('a failed load of the api router is retried on the next call, and reloads once after a deploy', async () => {
  jest.resetModules();
  const reloadForNewBuild = jest.fn();
  let chunkMissing = true;
  jest.doMock('./utils/lazyWithReload', () => ({ isChunkLoadError: () => true, reloadForNewBuild }));
  jest.doMock('./utils/supabaseApi', () => {
    if (chunkMissing) throw new Error('Loading chunk 123 failed.');
    return { executeSupabaseRoute: async () => ({ answered: 'in the browser' }) };
  });
  const fresh = require('./api');

  await expect(fresh.api.get('/search?q=x')).rejects.toThrow('Loading chunk 123 failed.');
  expect(reloadForNewBuild).toHaveBeenCalledTimes(1);

  chunkMissing = false;
  await expect(fresh.api.get('/search?q=x')).resolves.toEqual({ answered: 'in the browser' });

  jest.dontMock('./utils/lazyWithReload');
  jest.dontMock('./utils/supabaseApi');
});
