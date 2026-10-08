// TV mode: a 10-foot layout for TVs driven by a remote (Fire TV / Android
// TV through the binge. TV app, smart-TV browsers). Turned on by the TV
// app's user agent ("BingeTV"), TV browser user agents, or ?tv=1 (?tv=0
// turns it off; the choice is remembered on that device).
const TV_UA = /(BingeTV|\bAFT[A-Z0-9]*\b|Android TV|GoogleTV|BRAVIA|SMART-TV|SmartTV|Tizen|Web0S|webOS|CrKey)/i;
const KEY = 'binge:tv-mode';

let cached = null;

export function isTvMode() {
  if (cached !== null) return cached;
  if (typeof window === 'undefined') return false;
  let forced = null;
  try {
    const param = new URLSearchParams(window.location.search).get('tv');
    if (param === '1' || param === '0') window.localStorage.setItem(KEY, param);
    forced = window.localStorage.getItem(KEY);
  } catch { /* private mode */ }
  cached = forced === '1' ? true : forced === '0' ? false : TV_UA.test(navigator.userAgent || '');
  return cached;
}

// Called once before the first render so the very first paint is TV-sized.
export function applyTvMode() {
  if (isTvMode()) document.documentElement.classList.add('tv-mode');
}
