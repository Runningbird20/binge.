import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Signup from './Signup';
import * as supabaseDataModule from '../utils/supabaseData';
import { mockNavigate, renderWithAuth, installPageTestHooks } from '../testUtils/pageTestSetup';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });

installPageTestHooks();

test('renders signup fields for username, bio, avatar, and password', () => {
  renderWithAuth(<Signup />);

  expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/upload avatar photo/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/bio/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
});

test('uses an uploaded photo as the avatar preview', async () => {
  renderWithAuth(<Signup />);

  const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText(/upload avatar photo/i), file);

  expect(screen.getByText(/avatar\.png selected for your avatar/i)).toBeInTheDocument();

  const preview = await screen.findByRole('img', { name: /avatar preview/i });
  expect(preview).toHaveAttribute('src', 'data:image/png;base64,avatar-preview');
});

test('creates an account with bio and avatar details', async () => {
  // AuthProvider's mount-time session bootstrap otherwise races real
  // Supabase network calls in this environment; short-circuit it so it
  // resolves deterministically instead of potentially clobbering the
  // profile signUp() writes to localStorage.
  const sessionProfileSpy = jest.spyOn(supabaseDataModule, 'getSupabaseSessionProfile').mockResolvedValue(null);
  const signUpSpy = jest.spyOn(supabaseDataModule, 'signUpWithSupabase').mockResolvedValue({
    user: {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'I keep a short list of everything I finish.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
      createdAt: null,
      userType: 'user',
      isAdmin: false,
      isDev: false,
    },
    requiresEmailConfirmation: false,
  });

  renderWithAuth(<Signup />);

  const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText(/upload avatar photo/i), file);
  await userEvent.type(screen.getByLabelText(/username/i), 'mediafan');
  await userEvent.type(screen.getByLabelText(/email/i), 'mediafan@example.com');
  await userEvent.type(
    screen.getByLabelText(/bio/i),
    'I keep a short list of everything I finish.'
  );
  await userEvent.type(screen.getByLabelText(/password/i), 'secretpass123');
  await userEvent.click(screen.getByRole('button', { name: /create account/i }));

  await waitFor(() => {
    expect(signUpSpy).toHaveBeenCalledTimes(1);
  });

  expect(signUpSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      username: 'mediafan',
      email: 'mediafan@example.com',
      password: 'secretpass123',
      bio: 'I keep a short list of everything I finish.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    })
  );

  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith('/home');
  });
  await waitFor(() => {
    expect(JSON.parse(localStorage.getItem('user'))).toEqual(
      expect.objectContaining({
        username: 'mediafan',
        bio: 'I keep a short list of everything I finish.',
        avatarUrl: 'data:image/png;base64,avatar-preview',
      })
    );
  });

  signUpSpy.mockRestore();
  sessionProfileSpy.mockRestore();
});
