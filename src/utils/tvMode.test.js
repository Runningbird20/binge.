function load({ ua = '', search = '', stored = null } = {}) {
  jest.resetModules();
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  window.history.replaceState({}, '', `/home${search}`);
  window.localStorage.clear();
  if (stored) window.localStorage.setItem('binge:tv-mode', stored);
  // eslint-disable-next-line global-require
  return require('./tvMode');
}

describe('TV mode detection', () => {
  it('turns on for the binge. TV app and Fire TV / TV browsers', () => {
    expect(load({ ua: 'Mozilla/5.0 (Linux; Android 9; AFTMM) Chrome/120 BingeTV/1.0' }).isTvMode()).toBe(true);
    expect(load({ ua: 'Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7633)' }).isTvMode()).toBe(true);
    expect(load({ ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0)' }).isTvMode()).toBe(true);
  });

  it('stays off on phones and desktops', () => {
    expect(load({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }).isTvMode()).toBe(false);
    expect(load({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120' }).isTvMode()).toBe(false);
  });

  it('?tv=1 / ?tv=0 override and are remembered', () => {
    expect(load({ ua: 'Mozilla/5.0 (Macintosh)', search: '?tv=1' }).isTvMode()).toBe(true);
    expect(window.localStorage.getItem('binge:tv-mode')).toBe('1');
    expect(load({ ua: 'Mozilla/5.0 AFTMM BingeTV/1.0', stored: '0' }).isTvMode()).toBe(false);
  });
});
