import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountSettings from './AccountSettings';
import * as AuthContextModule from '../contexts/AuthContext';
import { installPageTestHooks } from '../testUtils/pageTestSetup';

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
