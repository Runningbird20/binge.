import { act, render, screen } from '@testing-library/react';

var mockOnAuthStateChange = jest.fn();
var mockGetSupabaseSessionProfile = jest.fn();
var mockResolveSupabaseProfile = jest.fn();
var mockSignInWithSupabase = jest.fn();
var mockSignOutFromSupabase = jest.fn();
var mockSignUpWithSupabase = jest.fn();
var mockUpdateSupabasePassword = jest.fn();
var mockUpdateSupabaseProfile = jest.fn();

jest.mock('../utils/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      onAuthStateChange: (...args) => mockOnAuthStateChange(...args),
    },
  },
}));

jest.mock('../utils/supabaseData', () => ({
  getSupabaseSessionProfile: (...args) => mockGetSupabaseSessionProfile(...args),
  resolveSupabaseProfile: (...args) => mockResolveSupabaseProfile(...args),
  signInWithSupabase: (...args) => mockSignInWithSupabase(...args),
  signOutFromSupabase: (...args) => mockSignOutFromSupabase(...args),
  signUpWithSupabase: (...args) => mockSignUpWithSupabase(...args),
  updateSupabasePassword: (...args) => mockUpdateSupabasePassword(...args),
  updateSupabaseProfile: (...args) => mockUpdateSupabaseProfile(...args),
}));

import { AuthProvider, useAuth } from './AuthContext';

function RoleProbe() {
  const { authLoading, user } = useAuth();

  return (
    <div data-testid="role-state">
      {authLoading
        ? 'loading'
        : `${user?.userType || 'none'}|${user?.isDev ? 'dev' : 'not-dev'}|${user?.isAdmin ? 'admin' : 'not-admin'}`}
    </div>
  );
}

describe('AuthProvider', () => {
  let authListenerCallback;

  beforeEach(() => {
    authListenerCallback = null;
    mockOnAuthStateChange.mockReset();
    mockGetSupabaseSessionProfile.mockReset();
    mockResolveSupabaseProfile.mockReset();

    mockOnAuthStateChange.mockImplementation((callback) => {
      authListenerCallback = callback;
      return {
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      };
    });
  });

  test('does not downgrade a dev session when a later auth refresh resolves as a plain user', async () => {
    mockGetSupabaseSessionProfile.mockResolvedValue({
      id: 'dev-user',
      username: 'devops',
      userType: 'dev',
      isDev: true,
      isAdmin: false,
    });

    mockResolveSupabaseProfile.mockResolvedValue({
      id: 'dev-user',
      username: 'devops',
      userType: 'user',
      isDev: false,
      isAdmin: false,
    });

    render(
      <AuthProvider>
        <RoleProbe />
      </AuthProvider>
    );

    expect(await screen.findByText('dev|dev|not-admin')).toBeInTheDocument();

    await act(async () => {
      await authListenerCallback('TOKEN_REFRESHED', {
        user: {
          id: 'dev-user',
        },
      });
    });

    expect(screen.getByText('dev|dev|not-admin')).toBeInTheDocument();
  });
});
