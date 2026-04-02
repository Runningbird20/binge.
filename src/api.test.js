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
    /unable to reach the api/i
  );
});
