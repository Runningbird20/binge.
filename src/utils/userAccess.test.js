import { canAccessUserType, getDefaultRouteForUserType } from './userAccess';

describe('user access helpers', () => {
  test('routes dev users to home when only the dev flag is present', () => {
    expect(getDefaultRouteForUserType({
      userType: '',
      isAdmin: false,
      isDev: true,
    })).toBe('/home');
  });

  test('lets dev users access dev-only routes when the role comes from flags', () => {
    expect(canAccessUserType({
      userType: null,
      isAdmin: false,
      isDev: true,
    }, ['dev', 'admin'])).toBe(true);
  });

  test('treats raw Supabase-shaped is_dev flags as dev access', () => {
    expect(getDefaultRouteForUserType({
      user_type: null,
      is_admin: false,
      is_dev: true,
    })).toBe('/home');

    expect(canAccessUserType({
      user_type: null,
      is_admin: false,
      is_dev: true,
    }, ['dev', 'admin'])).toBe(true);
  });

  test('routes admins to home like every other account', () => {
    expect(getDefaultRouteForUserType({
      userType: 'user',
      isAdmin: true,
      isDev: true,
    })).toBe('/home');
  });
});
