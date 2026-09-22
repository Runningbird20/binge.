import { act, render, screen } from '@testing-library/react';

var mockOnAuthStateChange = jest.fn();
var mockGetSessionProfile = jest.fn();
var mockResolveProfile = jest.fn();
var mockSignIn = jest.fn();
var mockSignOut = jest.fn();
var mockSignUp = jest.fn();
var mockUpdatePassword = jest.fn();
var mockUpdateProfile = jest.fn();

jest.mock('../utils/backendClient', () => ({
  client: {
    auth: {
      onAuthStateChange: (...args) => mockOnAuthStateChange(...args),
    },
  },
}));

jest.mock('../utils/userData', () => ({
  getSessionProfile: (...args) => mockGetSessionProfile(...args),
  resolveProfile: (...args) => mockResolveProfile(...args),
  signIn: (...args) => mockSignIn(...args),
  signOut: (...args) => mockSignOut(...args),
  signUp: (...args) => mockSignUp(...args),
  updatePassword: (...args) => mockUpdatePassword(...args),
  updateProfile: (...args) => mockUpdateProfile(...args),
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
    mockGetSessionProfile.mockReset();
    mockResolveProfile.mockReset();

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
    mockGetSessionProfile.mockResolvedValue({
      id: 'dev-user',
      username: 'devops',
      userType: 'dev',
      isDev: true,
      isAdmin: false,
    });

    mockResolveProfile.mockResolvedValue({
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
