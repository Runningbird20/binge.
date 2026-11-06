import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InstallApp from './InstallApp';
import useDeviceType from '../hooks/useDeviceType';
import { APP_DOWNLOADS, captureInstallPrompt } from '../utils/installApp';

jest.mock('../hooks/useDeviceType', () => jest.fn());

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const as = (userAgent) => jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);

beforeAll(() => captureInstallPrompt());
beforeEach(() => useDeviceType.mockReturnValue({ isMobile: true }));
afterEach(() => jest.restoreAllMocks());

test('Android: Add to Home Screen through the browser’s own dialog, or download the app', async () => {
  as(ANDROID);
  render(<InstallApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  // Before Chrome has offered to install: where to find it in the menu.
  expect(screen.getByText(/In your browser’s menu/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download binge.apk' })).toHaveAttribute('href', APP_DOWNLOADS.android);

  const offer = new Event('beforeinstallprompt', { cancelable: true });
  offer.prompt = jest.fn();
  offer.userChoice = Promise.resolve({ outcome: 'accepted' });
  act(() => { window.dispatchEvent(offer); });
  fireEvent.click(screen.getByRole('button', { name: 'Add to Home Screen' }));
  expect(offer.prompt).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText('Install binge.')).toBeNull()); // installed: the sheet closes
});

test('iPhone: the Share steps, and the app’s download link to take to a computer', async () => {
  as(IPHONE);
  const writeText = jest.fn().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<InstallApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  expect(screen.getByText(/in Safari’s toolbar/)).toBeInTheDocument();
  expect(screen.getByText(/Sideloadly or AltStore/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Copy the download link/ }));
  expect(writeText).toHaveBeenCalledWith(APP_DOWNLOADS.ios);
  expect(await screen.findByRole('button', { name: /Link copied/ })).toBeInTheDocument();
});

test('not inside the phone apps, and not on computers', () => {
  as(`${ANDROID} BingeApp/1.0`);
  const { unmount } = render(<InstallApp />);
  expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  unmount();
  as(ANDROID);
  useDeviceType.mockReturnValue({ isMobile: false });
  render(<InstallApp />);
  expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
});
