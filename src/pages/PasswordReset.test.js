import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PasswordReset from './PasswordReset';
import { api } from '../api';
import { requireSupabaseClient } from '../utils/supabase';

jest.mock('react-router-dom', () => ({ Link: ({ children, to }) => <a href={to}>{children}</a> }), { virtual: true });
jest.mock('../utils/supabase', () => ({ requireSupabaseClient: jest.fn() }));
jest.mock('../api', () => ({ api: { post: jest.fn() } }));

let auth;
beforeEach(() => {
  auth = {
    getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'user' } } } }),
    resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
    updateUser: jest.fn().mockResolvedValue({ error: null }),
    verifyOtp: jest.fn().mockResolvedValue({ data: { session: {} }, error: null }),
  };
  requireSupabaseClient.mockReturnValue({ auth });
  api.post.mockResolvedValue({ sent: true });
  window.history.replaceState(null, '', '/');
});

test('asks binge. to email the reset link', async () => {
  render(<PasswordReset />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' user@example.com ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByRole('status')).toHaveTextContent('If an account exists');
  expect(api.post).toHaveBeenCalledWith('/account/password-reset', { email: 'user@example.com' });
  expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
});

test('shows why binge. could not send the link', async () => {
  api.post.mockRejectedValue(new Error('Too many reset requests from here. Try again in an hour.'));
  render(<PasswordReset />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many reset requests');
  expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
});

test('falls back to a Supabase reset email when the server has no email set up', async () => {
  api.post.mockResolvedValue({ fallback: true });
  render(<PasswordReset />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  await screen.findByRole('status');
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', { redirectTo: `${window.location.origin}/reset-password` });
  expect(screen.getByRole('status')).toHaveTextContent('If an account exists');
});

test('rejects mismatching passwords and updates the authenticated Supabase user', async () => {
  render(<PasswordReset recovery />);
  const input = await screen.findByLabelText('New password');
  fireEvent.change(input, { target: { value: 'new-password' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
  expect(auth.updateUser).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
  await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Your password has been updated');
});

test('blocks password updates without a valid session', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  render(<PasswordReset recovery />);
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('a link from binge.\'s email signs in with its token, once, and leaves the address', async () => {
  window.history.replaceState(null, '', '/reset-password?token_hash=link-1&type=recovery');
  render(<PasswordReset recovery />);
  expect(await screen.findByLabelText('New password')).toBeInTheDocument();
  expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
  expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'link-1', type: 'recovery' });
  expect(window.location.search).toBe('');
});

test('a used or expired link from binge.\'s email asks for a new one', async () => {
  auth.verifyOtp.mockResolvedValue({ data: {}, error: new Error('Token has expired or is invalid') });
  window.history.replaceState(null, '', '/reset-password?token_hash=link-2&type=recovery');
  render(<PasswordReset recovery />);
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired');
  expect(screen.getByRole('link', { name: 'Request a new reset link' })).toBeInTheDocument();
  expect(auth.getSession).not.toHaveBeenCalled();
});

test('shows Supabase email delivery errors', async () => {
  api.post.mockResolvedValue({ fallback: true });
  auth.resetPasswordForEmail.mockResolvedValue({ error: new Error('Email rate limit exceeded') });
  render(<PasswordReset />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email rate limit exceeded');
});
