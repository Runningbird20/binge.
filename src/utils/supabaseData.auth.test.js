import { buildSupabaseUserProfile } from './supabaseData';

describe('buildSupabaseUserProfile', () => {
  test('keeps a dev role from the stored profile when auth metadata has no role flags', () => {
    const profile = buildSupabaseUserProfile(
      {
        id: 'dev-user',
        email: 'dev@example.com',
        user_metadata: {
          username: 'devops',
        },
      },
      {
        id: 'dev-user',
        email: 'dev@example.com',
        username: 'devops',
        is_admin: false,
        is_dev: true,
        bio: '',
        avatar_url: null,
        created_at: '2026-04-16T00:00:00.000Z',
      }
    );

    expect(profile).toEqual(
      expect.objectContaining({
        id: 'dev-user',
        username: 'devops',
        userType: 'dev',
        isDev: true,
        isAdmin: false,
      })
    );
  });
});
