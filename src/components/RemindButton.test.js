import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import RemindButton from './RemindButton';
import { createReminder } from '../utils/reminders';
import { fetchEmailAlerts, saveEmailAlerts } from '../utils/emailAlerts';
import { fetchShowAlerts, saveShowAlerts } from '../utils/showAlerts';

jest.mock('sonner', () => ({ toast: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../utils/reminders', () => ({
  ...jest.requireActual('../utils/reminders'),
  createReminder: jest.fn(),
  reminderPresets: () => [{ id: 'tonight', label: 'Tonight at 8 PM', when: new Date(2026, 10, 18, 20) }],
}));
jest.mock('../utils/pushNotifications', () => ({
  enableNewEpisodeAlerts: jest.fn(), isSubscribed: jest.fn(), pushPermission: () => 'default', pushSupported: () => false,
}));
jest.mock('../utils/haptics', () => ({ haptic: () => {} }));
jest.mock('../utils/emailAlerts', () => ({ fetchEmailAlerts: jest.fn(), saveEmailAlerts: jest.fn() }));
jest.mock('../utils/showAlerts', () => ({ fetchShowAlerts: jest.fn(), saveShowAlerts: jest.fn() }));

let mockAuth;

beforeEach(() => {
  mockAuth = { user: { id: 'u1', email: 'sam@example.com' }, activeProfile: { id: 'p1', is_kids: false } };
  createReminder.mockReset().mockResolvedValue({ id: 5 });
  fetchEmailAlerts.mockReset().mockResolvedValue(null);
  saveEmailAlerts.mockReset().mockImplementation(async (enabled) => enabled);
  toast.mockReset();
  fetchShowAlerts.mockReset().mockResolvedValue(true);
  saveShowAlerts.mockReset().mockImplementation(async (id, on) => on);
});

async function setReminder() {
  render(<RemindButton item={{ id: 7, title: 'Dune' }} mediaType="movie" />);
  fireEvent.click(screen.getByRole('button', { name: 'Remind me to watch' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Tonight at 8 PM' }));
  await waitFor(() => expect(createReminder).toHaveBeenCalled());
}

test('the first reminder asks about email; “Email me” turns email alerts on', async () => {
  await setReminder();

  const dialog = await screen.findByRole('dialog', { name: 'Email you reminders too?' });
  expect(dialog).toHaveTextContent('sam@example.com');
  expect(screen.getByRole('button', { name: 'Email me' })).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Email me' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(saveEmailAlerts).toHaveBeenCalledWith(true);
  expect(toast).toHaveBeenCalledWith('Email reminders on', { description: 'They’ll go to sam@example.com.' });
});

test('“Not now” saves no, so it isn’t asked again', async () => {
  await setReminder();
  fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(saveEmailAlerts).toHaveBeenCalledWith(false);
});

test('Escape answers no and closes only the question, not the title popup under it', async () => {
  const popupEscape = jest.fn();
  window.addEventListener('keydown', popupEscape);
  await setReminder();
  await screen.findByRole('dialog');

  fireEvent.keyDown(screen.getByRole('button', { name: 'Email me' }), { key: 'Escape' }); // it has focus

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(saveEmailAlerts).toHaveBeenCalledWith(false);
  expect(popupEscape).not.toHaveBeenCalled();
  window.removeEventListener('keydown', popupEscape);
});

test('if turning it on doesn’t save, the question stays and says so', async () => {
  saveEmailAlerts.mockRejectedValue(new Error('Couldn’t save your email setting. Try again.'));
  await setReminder();
  fireEvent.click(await screen.findByRole('button', { name: 'Email me' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save your email setting. Try again.');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('an account that already chose isn’t asked', async () => {
  fetchEmailAlerts.mockResolvedValue(false);
  await setReminder();
  await waitFor(() => expect(fetchEmailAlerts).toHaveBeenCalled());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a kids profile isn’t asked: it’s the account holder’s inbox', async () => {
  mockAuth = { ...mockAuth, activeProfile: { id: 'k1', is_kids: true } };
  await setReminder();
  expect(fetchEmailAlerts).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

describe('on a series', () => {
  const SERIES = { id: 10, title: 'Severance' };
  const renderSeries = () => render(<RemindButton item={SERIES} mediaType="tv_show" />);
  const bell = () => screen.getByRole('button', { name: 'Alerts for new episodes and seasons' });

  test('the bell is the switch for new-episode and new-season alerts, on already for a show you follow', async () => {
    renderSeries();
    await waitFor(() => expect(bell()).toHaveAttribute('aria-pressed', 'true'));
    expect(fetchShowAlerts).toHaveBeenCalledWith(10);
    expect(bell()).toHaveAttribute('title', 'Alerts on for new episodes and seasons');
    // No menu, no reminder times.
    expect(bell()).not.toHaveAttribute('aria-haspopup');
  });

  test('tapping it off mutes the show', async () => {
    renderSeries();
    await waitFor(() => expect(bell()).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(bell());
    await waitFor(() => expect(saveShowAlerts).toHaveBeenCalledWith(10, false));
    expect(bell()).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Alerts off for Severance', { description: 'Tap the bell to turn them back on.' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('tapping it on follows a show that isn’t on your list, and asks about email the first time', async () => {
    fetchShowAlerts.mockResolvedValue(false);
    renderSeries();
    await waitFor(() => expect(bell()).toBeEnabled()); // known, and off
    expect(bell()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(bell());
    await waitFor(() => expect(saveShowAlerts).toHaveBeenCalledWith(10, true));
    expect(toast).toHaveBeenCalledWith('Alerts on for Severance', { description: 'New episodes and new seasons will show up under the bell.' });
    expect(await screen.findByRole('dialog', { name: 'Email you about new episodes too?' })).toHaveTextContent('sam@example.com');
  });

  test('if it doesn’t save, the bell goes back and says why', async () => {
    saveShowAlerts.mockRejectedValue(new Error('Couldn’t save that. Try again.'));
    renderSeries();
    await waitFor(() => expect(bell()).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(bell());
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Couldn’t save that. Try again.'));
    expect(bell()).toHaveAttribute('aria-pressed', 'true');
  });

  test('a movie’s bell is still a reminder to watch', () => {
    render(<RemindButton item={{ id: 7, title: 'Dune' }} mediaType="movie" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remind me to watch' }));
    expect(screen.getByRole('menuitem', { name: 'Tonight at 8 PM' })).toBeInTheDocument();
    expect(fetchShowAlerts).not.toHaveBeenCalled();
  });
});
