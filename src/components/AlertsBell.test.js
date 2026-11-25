import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import AlertsBell from './AlertsBell';
import { fetchEmailAlerts, saveEmailAlerts } from '../utils/emailAlerts';
import { fetchShowAlerts, saveShowAlerts } from '../utils/showAlerts';

jest.mock('sonner', () => ({ toast: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../utils/pushNotifications', () => ({
  enableNewEpisodeAlerts: jest.fn(), isSubscribed: jest.fn(), pushPermission: () => 'default', pushSupported: () => false,
}));
jest.mock('../utils/haptics', () => ({ haptic: () => {} }));
jest.mock('../utils/emailAlerts', () => ({ fetchEmailAlerts: jest.fn(), saveEmailAlerts: jest.fn() }));
jest.mock('../utils/showAlerts', () => ({ fetchShowAlerts: jest.fn(), saveShowAlerts: jest.fn() }));

const SERIES = { id: 10, title: 'Severance' };
let mockAuth;

beforeEach(() => {
  mockAuth = { user: { id: 'u1', email: 'sam@example.com' }, activeProfile: { id: 'p1', is_kids: false } };
  fetchShowAlerts.mockReset().mockResolvedValue(true);
  saveShowAlerts.mockReset().mockImplementation(async (id, on) => on);
  fetchEmailAlerts.mockReset().mockResolvedValue(null);
  saveEmailAlerts.mockReset().mockImplementation(async (enabled) => enabled);
  toast.mockReset();
});

const bell = () => screen.getByRole('button', { name: 'Alerts for new episodes and seasons' });

async function renderBell(following = true) {
  fetchShowAlerts.mockResolvedValue(following);
  render(<AlertsBell item={SERIES} />);
  await waitFor(() => expect(bell()).toBeEnabled()); // known
  expect(bell()).toHaveAttribute('aria-pressed', String(following));
}

// Turns alerts on, which is when the email question can come.
async function turnOn() {
  await renderBell(false);
  fireEvent.click(bell());
  await waitFor(() => expect(saveShowAlerts).toHaveBeenCalledWith(10, true));
}

test('the bell is the switch for new-episode and new-season alerts, on already for a show you follow', async () => {
  await renderBell(true);
  expect(fetchShowAlerts).toHaveBeenCalledWith(10);
  expect(bell()).toHaveAttribute('title', 'Alerts on for new episodes and seasons');
  expect(bell()).not.toHaveAttribute('aria-haspopup');
});

test('tapping it off mutes the show', async () => {
  await renderBell(true);
  fireEvent.click(bell());
  await waitFor(() => expect(saveShowAlerts).toHaveBeenCalledWith(10, false));
  expect(bell()).toHaveAttribute('aria-pressed', 'false');
  await waitFor(() => expect(toast).toHaveBeenCalledWith('Alerts off for Severance', { description: 'Tap the bell to turn them back on.' }));
  expect(fetchEmailAlerts).not.toHaveBeenCalled();
});

test('tapping it on follows a show that isn’t on your list', async () => {
  await turnOn();
  expect(bell()).toHaveAttribute('aria-pressed', 'true');
  expect(toast).toHaveBeenCalledWith('Alerts on for Severance', { description: 'New episodes and new seasons will show up under the bell.' });
});

test('if it doesn’t save, the bell goes back and says why', async () => {
  saveShowAlerts.mockRejectedValue(new Error('Couldn’t save that. Try again.'));
  await renderBell(true);
  fireEvent.click(bell());
  await waitFor(() => expect(toast).toHaveBeenCalledWith('Couldn’t save that. Try again.'));
  expect(bell()).toHaveAttribute('aria-pressed', 'true');
});

describe('the email question, the first time alerts are turned on', () => {
  test('“Email me” turns email alerts on', async () => {
    await turnOn();
    const dialog = await screen.findByRole('dialog', { name: 'Email you about new episodes too?' });
    expect(dialog).toHaveTextContent('sam@example.com');
    expect(screen.getByRole('button', { name: 'Email me' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Email me' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(saveEmailAlerts).toHaveBeenCalledWith(true);
    expect(toast).toHaveBeenCalledWith('Email alerts on', { description: 'They’ll go to sam@example.com.' });
  });

  test('“Not now” saves no, so it isn’t asked again', async () => {
    await turnOn();
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(saveEmailAlerts).toHaveBeenCalledWith(false);
  });

  test('Escape answers no and closes only the question, not the title popup under it', async () => {
    const popupEscape = jest.fn();
    window.addEventListener('keydown', popupEscape);
    await turnOn();
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Email me' }), { key: 'Escape' }); // it has focus
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(saveEmailAlerts).toHaveBeenCalledWith(false);
    expect(popupEscape).not.toHaveBeenCalled();
    window.removeEventListener('keydown', popupEscape);
  });

  test('if turning email on doesn’t save, the question stays and says so', async () => {
    saveEmailAlerts.mockRejectedValue(new Error('Couldn’t save your email setting. Try again.'));
    await turnOn();
    fireEvent.click(await screen.findByRole('button', { name: 'Email me' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save your email setting. Try again.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('an account that already chose isn’t asked', async () => {
    fetchEmailAlerts.mockResolvedValue(false);
    await turnOn();
    await waitFor(() => expect(fetchEmailAlerts).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('a kids profile isn’t asked: it’s the account holder’s inbox', async () => {
    mockAuth = { ...mockAuth, activeProfile: { id: 'k1', is_kids: true } };
    await turnOn();
    expect(fetchEmailAlerts).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
