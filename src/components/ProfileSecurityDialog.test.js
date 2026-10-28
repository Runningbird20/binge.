import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProfileSecurityDialog from './ProfileSecurityDialog';
import { requireSupabaseClient } from '../utils/supabase';
import { signInWithSupabase, updateAccountProfile } from '../utils/supabaseData';
jest.mock('../utils/supabase', () => ({ requireSupabaseClient: jest.fn() }));
jest.mock('../utils/supabaseData', () => ({ signInWithSupabase: jest.fn(), updateAccountProfile: jest.fn() }));
const profile = { id: 'profile-1', name: 'Carl', is_kids: false };
let rpc;
beforeEach(() => { jest.clearAllMocks(); rpc = jest.fn().mockResolvedValue({ data: true }); requireSupabaseClient.mockReturnValue({ rpc }); });
test('does not unlock after an incorrect PIN', async () => {
  rpc.mockResolvedValue({ data: false });
  const onUnlock = jest.fn();
  render(<ProfileSecurityDialog profile={profile} onUnlock={onUnlock} />);
  fireEvent.change(screen.getByLabelText('Four-digit PIN'), { target: { value: '1234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect PIN');
  expect(onUnlock).not.toHaveBeenCalled();
});
test('unlocks only after server verification', async () => {
  const onUnlock = jest.fn();
  render(<ProfileSecurityDialog profile={profile} onUnlock={onUnlock} />);
  fireEvent.change(screen.getByLabelText('Four-digit PIN'), { target: { value: '0123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  expect(rpc).toHaveBeenCalledWith('verify_profile_pin', { target_profile: profile.id, entered_pin: '0123' });
});
test('failed account password verification prevents profile changes', async () => {
  signInWithSupabase.mockRejectedValue(new Error('Invalid password'));
  render(<ProfileSecurityDialog editing profile={profile} email="user@example.com" />);
  fireEvent.change(screen.getByLabelText('Account password'), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid password');
  expect(updateAccountProfile).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
