import { useSyncExternalStore } from 'react';

// "Install binge." (the header's Install button, components/InstallApp.js): add
// the site to the Home Screen, or download the phone apps, which CI publishes
// on the mobile-latest release (.github/workflows/mobile-apps.yml). Not
// releases/latest/…: that's the Fire TV app.
const RELEASE = 'https://github.com/Runningbird20/binge./releases/download/mobile-latest';
export const APP_DOWNLOADS = { android: `${RELEASE}/binge.apk`, ios: `${RELEASE}/binge.ipa` };

let deferredPrompt = null;
let installedNow = false;
let capturing = false;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

// Chrome (Android) offers to install the site once it qualifies. Hold on to
// that offer instead of letting it show its own banner, so the Install button
// can open the browser's install dialog. Call this at startup: the offer can
// come before the header is on screen.
export function captureInstallPrompt() {
  if (capturing || typeof window === 'undefined') return;
  capturing = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedNow = true;
    notify();
  });
}

// 'ios' (iPhone, and iPads, which say they're a Mac), 'android' or 'other'.
export function installPlatform(userAgent = navigator.userAgent, touchPoints = navigator.maxTouchPoints || 0) {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}

// Nothing to offer: already on the Home Screen, or inside the phone apps
// (their user agent ends in BingeApp/1.0).
export function alreadyInstalled() {
  if (installedNow || /BingeApp\//.test(navigator.userAgent)) return true;
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);
}

// The browser's own install dialog, where it offered one. Resolves to
// 'accepted', 'dismissed', or 'unavailable' (no offer to show).
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  deferredPrompt = null; // usable once
  notify();
  event.prompt();
  const choice = await Promise.resolve(event.userChoice).catch(() => null);
  return choice?.outcome || 'dismissed';
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const snapshot = () => `${Boolean(deferredPrompt)}|${installedNow}`;

export function useInstallApp() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    canPrompt: state.startsWith('true'),
    installed: alreadyInstalled(),
    platform: installPlatform(),
  };
}
