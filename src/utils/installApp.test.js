import { act } from '@testing-library/react';

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

// A fresh copy of the module (it keeps the browser's offer in module state).
const load = () => {
  let mod;
  jest.isolateModules(() => { mod = require('./installApp'); });
  return mod;
};

afterEach(() => {
  jest.restoreAllMocks();
  delete window.matchMedia;
  delete navigator.standalone;
});

test('tells iPhones (and iPads, which say they’re a Mac) from Android', () => {
  const { installPlatform } = load();
  expect(installPlatform(IPHONE, 5)).toBe('ios');
  expect(installPlatform(IPAD, 5)).toBe('ios');
  expect(installPlatform(IPAD, 0)).toBe('other'); // a real Mac
  expect(installPlatform(ANDROID, 5)).toBe('android');
});

test('nothing to offer on the Home Screen or inside the phone apps', () => {
  const { alreadyInstalled } = load();
  expect(alreadyInstalled()).toBe(false);
  window.matchMedia = (query) => ({ matches: query === '(display-mode: standalone)' });
  expect(alreadyInstalled()).toBe(true);
  delete window.matchMedia;
  navigator.standalone = true; // iPhone Home Screen
  expect(alreadyInstalled()).toBe(true);
  delete navigator.standalone;
  jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(`${ANDROID} BingeApp/1.0`);
  expect(alreadyInstalled()).toBe(true);
});

test('holds Chrome’s install offer and shows its dialog once, from the button', async () => {
  const { captureInstallPrompt, promptInstall } = load();
  captureInstallPrompt();
  expect(await promptInstall()).toBe('unavailable');
  const offer = new Event('beforeinstallprompt', { cancelable: true });
  offer.prompt = jest.fn();
  offer.userChoice = Promise.resolve({ outcome: 'accepted' });
  act(() => { window.dispatchEvent(offer); });
  expect(offer.defaultPrevented).toBe(true); // no banner of Chrome's own
  expect(await promptInstall()).toBe('accepted');
  expect(offer.prompt).toHaveBeenCalledTimes(1);
  expect(await promptInstall()).toBe('unavailable'); // usable once
});
