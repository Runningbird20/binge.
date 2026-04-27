const mockInvokeSupabaseFunction = jest.fn();

jest.mock('./supabase', () => ({
  invokeSupabaseFunction: (...args) => mockInvokeSupabaseFunction(...args),
  isSupabaseConfigured: true,
}));

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

describe('devLabApi', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.REACT_APP_ENABLE_LEGACY_BACKEND;
    delete process.env.REACT_APP_DEVLAB_API_MODE;
    delete process.env.REACT_APP_DEVLAB_API_URL;
    delete process.env.REACT_APP_LEGACY_API_URL;
    delete global.fetch;
  });

  test('prefers the DB-backed dev-lab API when /api/dev-lab is available', async () => {
    const expected = { counts: {} };
    global.fetch
      .mockResolvedValueOnce(
        mockResponse({
          body: JSON.stringify({ ok: true, hasDatabaseUrl: true }),
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          body: JSON.stringify(expected),
        })
      );

    const { devLabApi } = require('./devLabApi');
    await expect(devLabApi.getDashboard()).resolves.toEqual(expected);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/dev-lab/status',
      expect.objectContaining({ method: 'GET' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/dev-lab/dashboard',
      expect.objectContaining({ method: 'GET' })
    );
    expect(mockInvokeSupabaseFunction).not.toHaveBeenCalled();
  });

  test('falls back to the Supabase function when the DB-backed dev-lab API is unavailable', async () => {
    const expected = { counts: {} };
    global.fetch.mockResolvedValueOnce(
      mockResponse({
        body: '<!doctype html><html><body>Not JSON</body></html>',
        contentType: 'text/html; charset=utf-8',
      })
    );
    mockInvokeSupabaseFunction.mockResolvedValue(expected);

    const { devLabApi } = require('./devLabApi');
    await expect(devLabApi.getDashboard()).resolves.toBe(expected);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockInvokeSupabaseFunction).toHaveBeenCalledWith('dev', { action: 'dashboard' });
  });

  test('falls back to Supabase when legacy backend mode is enabled but /api/dev-lab is down', async () => {
    process.env.REACT_APP_ENABLE_LEGACY_BACKEND = 'true';
    const expected = { counts: {} };
    global.fetch.mockRejectedValue(new Error('network down'));
    mockInvokeSupabaseFunction.mockResolvedValue(expected);

    const { devLabApi } = require('./devLabApi');
    await expect(devLabApi.getDashboard()).resolves.toBe(expected);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dev-lab/status',
      expect.objectContaining({ method: 'GET' })
    );
    expect(mockInvokeSupabaseFunction).toHaveBeenCalledWith('dev', { action: 'dashboard' });
  });

  test('supports forcing the DB-backed dev-lab API with a dedicated backend URL', async () => {
    process.env.REACT_APP_DEVLAB_API_MODE = 'server';
    process.env.REACT_APP_DEVLAB_API_URL = 'https://ops.example.com';
    const expected = { counts: {} };
    global.fetch.mockResolvedValue(
      mockResponse({
        body: JSON.stringify(expected),
      })
    );

    const { devLabApi } = require('./devLabApi');
    await expect(devLabApi.getDashboard()).resolves.toEqual(expected);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://ops.example.com/api/dev-lab/dashboard',
      expect.objectContaining({ method: 'GET' })
    );
    expect(mockInvokeSupabaseFunction).not.toHaveBeenCalled();
  });
});
