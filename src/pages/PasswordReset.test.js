import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PasswordReset from './PasswordReset';
import { requireSupabaseClient } from '../utils/supabase';

jest.mock('react-router-dom', () => ({ Link: ({ children, to }) => <a href={to}>{children}</a> }), { virtual: true });
jest.mock('../utils/supabase', () => ({ requireSupabaseClient: jest.fn() }));

let auth;
beforeEach(() => {
  auth = {
    getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'user' } } } }),
    resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
    updateUser: jest.fn().mockResolvedValue({ error: null }),
  };
  requireSupabaseClient.mockReturnValue({ auth });
});

test('sends a Supabase reset email to the public recovery route', async () => {
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

test('shows Supabase email delivery errors', async () => {
  auth.resetPasswordForEmail.mockResolvedValue({ error: new Error('Email rate limit exceeded') });
  render(<PasswordReset />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email rate limit exceeded');
});
