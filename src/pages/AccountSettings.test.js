import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountSettings from './AccountSettings';
import * as AuthContextModule from '../contexts/AuthContext';
import { installPageTestHooks, mockNavigate } from '../testUtils/pageTestSetup';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });

installPageTestHooks();

test('updates username and email from account settings', async () => {
  const updateProfileMock = jest.fn().mockResolvedValue({
    id: 7,
    username: 'newmediafan',
    email: 'newmediafan@example.com',
    bio: 'Always logging the next favorite.',
    avatarUrl: 'data:image/png;base64,avatar-preview',
  });

  const useAuthSpy = jest.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    },
    authLoading: false,
    updateProfile: updateProfileMock,
    updatePassword: jest.fn(),
    logout: jest.fn(),
  });

  render(<AccountSettings />);

  const usernameInput = screen.getByLabelText(/^username$/i);
  const emailInput = screen.getByLabelText(/^email$/i);

  await userEvent.clear(usernameInput);
  await userEvent.type(usernameInput, 'newmediafan');
  await userEvent.clear(emailInput);
  await userEvent.type(emailInput, 'newmediafan@example.com');
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => {
    expect(updateProfileMock).toHaveBeenCalledWith({
      username: 'newmediafan',
      email: 'newmediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    });
  });

  expect(await screen.findByText(/account details updated\./i)).toBeInTheDocument();

  useAuthSpy.mockRestore();
});

function mockAuthWithDelete(deleteAccount) {
  return jest.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: { id: 7, username: 'mediafan', email: 'mediafan@example.com', bio: '', avatarUrl: null },
    authLoading: false,
    updateProfile: jest.fn(),
    updatePassword: jest.fn(),
    logout: jest.fn(),
    deleteAccount,
  });
}

test('deletes the account after the password is entered, then leaves for the landing page', async () => {
  const deleteAccount = jest.fn().mockResolvedValue(undefined);
  const useAuthSpy = mockAuthWithDelete(deleteAccount);

  render(<AccountSettings />);

  expect(screen.queryByLabelText(/your password, to confirm/i)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^delete account$/i }));

  const confirm = screen.getByRole('button', { name: /delete my account forever/i });
  expect(confirm).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/your password, to confirm/i), 'hunter22');
  await userEvent.click(confirm);

  await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('hunter22'));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }));

  useAuthSpy.mockRestore();
});

test('shows why the account was not deleted and stays on the page', async () => {
  const deleteAccount = jest.fn().mockRejectedValue(new Error("That password isn't right."));
  const useAuthSpy = mockAuthWithDelete(deleteAccount);

  render(<AccountSettings />);

  await userEvent.click(screen.getByRole('button', { name: /^delete account$/i }));
  await userEvent.type(screen.getByLabelText(/your password, to confirm/i), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: /delete my account forever/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent("That password isn't right.");
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /delete my account forever/i })).toBeEnabled();

  // Cancel closes the confirmation and forgets the typed password.
  await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
  expect(screen.queryByLabelText(/your password, to confirm/i)).not.toBeInTheDocument();

  useAuthSpy.mockRestore();
});
