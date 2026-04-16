import { canAccessUserType, getDefaultRouteForUserType } from './userAccess';

describe('user access helpers', () => {
  test('routes dev users to the developer lab when only the dev flag is present', () => {
    expect(getDefaultRouteForUserType({
      userType: '',
      isAdmin: false,
      isDev: true,
    })).toBe('/__ops/dev-lab');
  });

  test('lets dev users access dev-only routes when the role comes from flags', () => {
    expect(canAccessUserType({
      userType: null,
      isAdmin: false,
      isDev: true,
    }, ['dev', 'admin'])).toBe(true);
  });

  test('keeps admin precedence when both role flags are present', () => {
    expect(getDefaultRouteForUserType({
      userType: 'user',
      isAdmin: true,
      isDev: true,
    })).toBe('/admin');
  });
});
