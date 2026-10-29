import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EditProfile from './EditProfile';
import * as AuthContextModule from '../contexts/AuthContext';
import * as supabaseModule from '../utils/supabase';
import * as supabaseDataModule from '../utils/supabaseData';
import * as profileLocksModule from '../utils/profileLocks';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
  useNavigate: () => mockNavigate,
  useParams: () => ({ profileId: 'p2' }),
}), { virtual: true });

const PROFILES = [
  { id: 'p1', name: 'Carl', is_default: true },
  { id: 'p2', name: 'Mattea', avatar_url: '🦊', avatar_color: '#3b82f6', is_kids: false },
];

function setup({ locked = false } = {}) {
  const refreshProfiles = jest.fn().mockResolvedValue();
  jest.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: { email: 'me@example.com' }, profiles: PROFILES, activeProfile: PROFILES[0], profilesLoading: false, refreshProfiles,
  });
  jest.spyOn(profileLocksModule, 'fetchProfileLocks').mockResolvedValue({ ids: new Set(locked ? ['p2'] : []), available: true });
  const rpc = jest.fn().mockResolvedValue({ error: null });
  jest.spyOn(supabaseModule, 'requireSupabaseClient').mockReturnValue({ rpc });
  const signIn = jest.spyOn(supabaseDataModule, 'signInWithSupabase').mockResolvedValue({});
  const update = jest.spyOn(supabaseDataModule, 'updateAccountProfile').mockResolvedValue();
  render(<EditProfile />);
  return { rpc, signIn, update, refreshProfiles };
}

afterEach(() => { jest.restoreAllMocks(); mockNavigate.mockReset(); });

async function saveWith(password) {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const field = await screen.findByLabelText('Account password');
  fireEvent.change(field, { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
}

test('saving asks for the account password in a pop-up, then returns to Manage Profiles', async () => {
  const { signIn, update } = setup();
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Matty' } });
  expect(screen.queryByLabelText('Account password')).toBeNull();
  await saveWith('right');
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/profiles?manage=1'));
  expect(signIn).toHaveBeenCalledWith({ email: 'me@example.com', password: 'right' });
  expect(update).toHaveBeenCalledWith('p2', expect.objectContaining({ name: 'Matty', maturity: 'all', avatarUrl: '🦊' }));
});

test('a wrong account password stops the save and shows in the pop-up', async () => {
  const { rpc, signIn, update } = setup();
  signIn.mockRejectedValue(new Error('Invalid password'));
  fireEvent.change(await screen.findByLabelText('Four-digit PIN'), { target: { value: '1234' } });
  fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: '1234' } });
  await saveWith('wrong');
  expect(await screen.findByText('Invalid password')).toHaveAttribute('role', 'alert');
  expect(screen.getByLabelText('Account password')).toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test('mismatched PINs are caught before the password is asked for', async () => {
  const { signIn } = setup();
  fireEvent.change(await screen.findByLabelText('Four-digit PIN'), { target: { value: '1234' } });
  fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: '4321' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('The PINs don’t match.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Account password')).toBeNull();
  expect(signIn).not.toHaveBeenCalled();
});

test('setting a PIN goes through the server lock function', async () => {
  const { rpc } = setup();
  fireEvent.change(await screen.findByLabelText('Four-digit PIN'), { target: { value: '2468' } });
  fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: '2468' } });
  await saveWith('right');
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_profile_lock', { target_profile: 'p2', new_pin: '2468' }));
});

test('only the main profile sees Delete profile', async () => {
  setup();
  expect(await screen.findByRole('button', { name: 'Delete profile' })).toBeInTheDocument();
});

test('maturity rating is a row of pills and saves the chosen level', async () => {
  const { update } = setup();
  const teens = await screen.findByRole('button', { name: 'Teens' });
  expect(screen.getByRole('group', { name: 'Maturity rating' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'No restrictions' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(teens);
  expect(teens).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Everything up to PG-13 and TV-14.')).toBeInTheDocument();
  await saveWith('right');
  await waitFor(() => expect(update).toHaveBeenCalledWith('p2', expect.objectContaining({ maturity: 'teens' })));
});
