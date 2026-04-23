const mockInvokeSupabaseFunction = jest.fn();
const mockGetSession = jest.fn();

jest.mock('./supabase', () => ({
  invokeSupabaseFunction: (...args) => mockInvokeSupabaseFunction(...args),
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: (...args) => mockGetSession(...args),
    },
  },
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

describe('chatbotApi', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.REACT_APP_CHATBOT_API_MODE;
    delete process.env.REACT_APP_CHATBOT_API_URL;
    delete process.env.REACT_APP_CHATBOT_FUNCTION_NAME;
    delete process.env.REACT_APP_LEGACY_API_URL;
    delete global.fetch;
  });

  test('falls back to /api/chat when the ai-chatbot edge function rejects the request', async () => {
    const expected = { response: 'server fallback response' };
    mockInvokeSupabaseFunction.mockRejectedValue(new Error('Missing authorization header'));
    global.fetch.mockResolvedValue(
      mockResponse({
        body: JSON.stringify(expected),
      })
    );

    const { sendChatbotMessage } = require('./chatbotApi');
    await expect(
      sendChatbotMessage({
        message: 'Recommend something fun',
        conversationHistory: [{ role: 'assistant', content: 'Sure.' }],
      })
    ).resolves.toEqual(expected);

    expect(mockInvokeSupabaseFunction).toHaveBeenCalledWith('ai-chatbot', {
      messages: [
        { role: 'assistant', content: 'Sure.' },
        { role: 'user', content: 'Recommend something fun' },
      ],
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  test('supports forcing a dedicated server chat backend URL', async () => {
    process.env.REACT_APP_CHATBOT_API_MODE = 'server';
    process.env.REACT_APP_CHATBOT_API_URL = 'https://api.example.com';
    const expected = { ok: true, models: ['llama-3.3-70b-versatile'] };
    global.fetch.mockResolvedValue(
      mockResponse({
        body: JSON.stringify(expected),
      })
    );

    const { checkChatbotStatus } = require('./chatbotApi');
    await expect(checkChatbotStatus()).resolves.toEqual(expected);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/chat/status',
      expect.objectContaining({
        method: 'GET',
      })
    );
    expect(mockInvokeSupabaseFunction).not.toHaveBeenCalled();
  });
});
