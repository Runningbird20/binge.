import { fireEvent, render, screen, within } from '@testing-library/react';
import { MobilePlaybackPickers, PlaybackOptionsPanel } from './PlaybackOptions';
import { SERVER_LABELS } from '../utils/embedProviders';
import { rememberRefusal } from '../utils/popupSandbox';

jest.mock('./BottomSheet', () => ({ open, title, children }) => (open ? <div role="dialog" aria-label={title}>{children}</div> : null));

const SERVERS = [{ id: 'cinesrc' }, { id: 'vidrift' }, { id: 'vidy' }, { id: 'vidlink' }, { id: '2embed' }];
const props = {
  prefs: { audio: 'original', subtitles: 'off' },
  onPrefsChange: () => {},
  servers: SERVERS,
  currentServer: 'cinesrc',
  serverLabels: SERVER_LABELS,
  onSelectServer: () => {},
  onReportBroken: () => {},
};
const serverRow = (name) => screen.getByText(name, { selector: '.st-pb-server-name, .mp-sheet-server > span' });
const marked = (name) => Boolean(within(serverRow(name)).queryByText('No pop-ups'));

beforeEach(() => window.localStorage.clear());

test('the server list marks the servers that play with pop-ups blocked', () => {
  render(<PlaybackOptionsPanel {...props} popupsBlockedNow />);
  expect(marked('CineSrc')).toBe(true);
  expect(marked('VidRift')).toBe(true);
  expect(marked('Vidy')).toBe(false);
  expect(marked('VidLink')).toBe(false);
  expect(marked('2Embed')).toBe(false);
  expect(screen.getByText(/Servers marked No pop-ups play with their pop-ups and redirects blocked/)).toBeInTheDocument();
});

test('the server playing shows what happened on this load, and a refusal learned here counts', () => {
  rememberRefusal('vidrift');
  // CineSrc was reloaded without the sandbox this time.
  render(<PlaybackOptionsPanel {...props} popupsBlockedNow={false} />);
  expect(marked('CineSrc')).toBe(false);
  expect(marked('VidRift')).toBe(false);
  expect(screen.queryByText(/Servers marked No pop-ups/)).toBeNull();
});

test('phones: the server sheet marks them too', () => {
  render(<MobilePlaybackPickers {...props} popupsBlockedNow />);
  fireEvent.click(screen.getByRole('button', { name: /Server/ }));
  const sheet = screen.getByRole('dialog', { name: 'Server' });
  expect(within(sheet).getAllByText('No pop-ups')).toHaveLength(2);
  expect(marked('VidRift')).toBe(true);
  expect(marked('Vidy')).toBe(false);
});
