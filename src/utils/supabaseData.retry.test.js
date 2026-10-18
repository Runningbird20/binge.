let mockSupabaseClient;

jest.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  get supabase() {
    return mockSupabaseClient;
  },
}));

import { signInWithSupabase } from './supabaseData';

function flushPromises() {
  return Promise.resolve();
}

describe('signInWithSupabase', () => {
  beforeEach(() => {
    jest.useFakeTimers();

    const profileRow = {
      id: 'user-1',
      email: 'slow@example.com',
      username: 'slowpoke',
      is_admin: false,
      is_dev: false,
      bio: '',
      avatar_url: null,
      created_at: '2026-04-16T00:00:00.000Z',
      user_type: 'user',
    };

    mockSupabaseClient = {
      auth: {
        signInWithPassword: jest.fn(),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({ data: profileRow, error: null }),
          })),
        })),
      })),
    };

    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('retries once after a timeout before completing the login flow', async () => {
    const authUser = {
      id: 'user-1',
      email: 'slow@example.com',
      user_metadata: {
        username: 'slowpoke',
      },
    };

    mockSupabaseClient.auth.signInWithPassword
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({
        data: { user: authUser },
        error: null,
      });

    const signInPromise = signInWithSupabase({
      email: 'slow@example.com',
      password: 'secret-password',
    });

    jest.advanceTimersByTime(15000);
    await flushPromises();

    await expect(signInPromise).resolves.toEqual(
      expect.objectContaining({
        id: 'user-1',
        email: 'slow@example.com',
        username: 'slowpoke',
        userType: 'user',
      })
    );

    expect(mockSupabaseClient.auth.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith('[auth] Supabase sign-in timed out. Retrying request...');
  });
});
