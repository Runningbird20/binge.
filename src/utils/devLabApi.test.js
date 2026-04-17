const mockApiGet = jest.fn();
const mockInvokeSupabaseFunction = jest.fn();

jest.mock('../api', () => ({
  api: {
    get: (...args) => mockApiGet(...args),
  },
}));

jest.mock('./supabase', () => ({
  invokeSupabaseFunction: (...args) => mockInvokeSupabaseFunction(...args),
  isSupabaseConfigured: true,
}));

describe('devLabApi', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.REACT_APP_ENABLE_LEGACY_BACKEND;
  });

  test('uses the local dev-lab API when the legacy backend flag is enabled', async () => {
    process.env.REACT_APP_ENABLE_LEGACY_BACKEND = 'true';
    const expected = { counts: {} };
    mockApiGet.mockResolvedValue(expected);

    const { devLabApi } = require('./devLabApi');
    await expect(devLabApi.getDashboard()).resolves.toBe(expected);

    expect(mockApiGet).toHaveBeenCalledWith('/dev-lab/dashboard');
    expect(mockInvokeSupabaseFunction).not.toHaveBeenCalled();
  });

  test('uses the Supabase function when the legacy backend flag is disabled', async () => {
    process.env.REACT_APP_ENABLE_LEGACY_BACKEND = 'false';
    const expected = { counts: {} };
    mockInvokeSupabaseFunction.mockResolvedValue(expected);

    const { devLabApi } = require('./devLabApi');
    await expect(devLabApi.getDashboard()).resolves.toBe(expected);

    expect(mockInvokeSupabaseFunction).toHaveBeenCalledWith('dev', { action: 'dashboard' });
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});
