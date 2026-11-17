import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Signup from './Signup';
import * as supabaseDataModule from '../utils/supabaseData';
import { fetchInvite, requestAccount, signUpWithInvite } from '../utils/accountRequests';
import { mockNavigate, renderWithAuth, installPageTestHooks, setMockSearchParams } from '../testUtils/pageTestSetup';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });
jest.mock('../utils/accountRequests', () => ({
  fetchInvite: jest.fn(),
  requestAccount: jest.fn(),
  signUpWithInvite: jest.fn(),
}));

installPageTestHooks();

describe('without an invite: asking for an account', () => {
  test('the form asks for a name, an email and an optional note', () => {
    renderWithAuth(<Signup />);
    expect(screen.getByRole('heading', { name: /request an account/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText(/anything we should know/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  test('sends the request and says where the answer will go', async () => {
    requestAccount.mockResolvedValue({ ok: true });
    renderWithAuth(<Signup />);
    await userEvent.type(screen.getByLabelText('Your name'), '  Leia Organa ');
    await userEvent.type(screen.getByLabelText('Email'), 'leia@example.com');
    await userEvent.type(screen.getByLabelText(/anything we should know/i), 'Friend of Luke');
    await userEvent.click(screen.getByRole('button', { name: 'Request account' }));

    expect(requestAccount).toHaveBeenCalledWith({ name: 'Leia Organa', email: 'leia@example.com', note: 'Friend of Luke' });
    expect(await screen.findByRole('status')).toHaveTextContent('We’ll email leia@example.com when it’s approved.');
  });

  test('shows why a request failed and keeps the form', async () => {
    requestAccount.mockRejectedValue(new Error('Too many requests from here. Try again in an hour.'));
    renderWithAuth(<Signup />);
    await userEvent.type(screen.getByLabelText('Your name'), 'Leia');
    await userEvent.type(screen.getByLabelText('Email'), 'leia@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Request account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many requests/);
    expect(screen.getByRole('button', { name: 'Request account' })).toBeInTheDocument();
  });
});

describe('with an invite: the regular sign-up form', () => {
  beforeEach(() => {
    setMockSearchParams('?invite=invite-token-123');
    fetchInvite.mockResolvedValue({ email: 'mediafan@example.com', name: 'Media Fan' });
  });

  test('checks the invite, then shows the form for that address', async () => {
    renderWithAuth(<Signup />);
    expect(screen.getByRole('progressbar', { name: /checking your invite/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /create your account/i })).toBeInTheDocument();
    expect(fetchInvite).toHaveBeenCalledWith('invite-token-123');
    expect(screen.getByLabelText('Email')).toHaveValue('mediafan@example.com');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/upload avatar photo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bio/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  test('uses an uploaded photo as the avatar preview', async () => {
    renderWithAuth(<Signup />);
    await screen.findByRole('heading', { name: /create your account/i });
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/upload avatar photo/i), file);

    expect(screen.getByText(/avatar\.png selected for your avatar/i)).toBeInTheDocument();
    const preview = await screen.findByRole('img', { name: /avatar preview/i });
    expect(preview).toHaveAttribute('src', 'data:image/png;base64,avatar-preview');
  });

  test('creates the account with the invite, then signs in', async () => {
    // AuthProvider's mount-time session bootstrap otherwise races real
    // Supabase network calls in this environment.
    const sessionProfileSpy = jest.spyOn(supabaseDataModule, 'getSupabaseSessionProfile').mockResolvedValue(null);
    signUpWithInvite.mockResolvedValue({
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
    await screen.findByRole('heading', { name: /create your account/i });
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/upload avatar photo/i), file);
    await userEvent.type(screen.getByLabelText(/username/i), 'mediafan');
    await userEvent.type(screen.getByLabelText(/bio/i), 'I keep a short list of everything I finish.');
    await userEvent.type(screen.getByLabelText(/password/i), 'secretpass123');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(signUpWithInvite).toHaveBeenCalledTimes(1));
    expect(signUpWithInvite).toHaveBeenCalledWith(expect.objectContaining({
      inviteToken: 'invite-token-123',
      username: 'mediafan',
      email: 'mediafan@example.com',
      password: 'secretpass123',
      bio: 'I keep a short list of everything I finish.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/home'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('user'))).toEqual(expect.objectContaining({ username: 'mediafan' })));
    sessionProfileSpy.mockRestore();
  });

  test('an expired or used invite says so, with the way back', async () => {
    fetchInvite.mockRejectedValue(new Error('This invite has expired. Request a new one.'));
    renderWithAuth(<Signup />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite has expired.');
    expect(screen.getByRole('link', { name: 'Request an account' })).toHaveAttribute('href', '/signup');
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });
});
