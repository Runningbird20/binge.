import { useEffect } from 'react';

// NOTE: This list must be kept in sync with the BLOCKED_DOMAINS array in
// public/sw.js — they cannot share a module because the Service Worker is a
// plain JS file that cannot import from the React source tree.
export const BLOCKED_DOMAINS = [
  'REPLACE_WITH_AD_DOMAIN_1',
  'REPLACE_WITH_AD_DOMAIN_2',
];

export default function PopupShield() {
  useEffect(() => {
    // Register the Service Worker so it can block ad network requests at the
    // network level, including requests made inside embedded iframes.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const originalOpen = window.open;
    window.open = function popupShieldOpen(url, target, features) {
      if (url) {
        try {
          const { hostname } = new URL(String(url), window.location.href);
          const host = hostname.toLowerCase();
          if (BLOCKED_DOMAINS.some((d) => host === d || host.endsWith('.' + d))) {
            return null;
          }
        } catch {
          // Unparseable URLs fall through to the original window.open.
        }
      }
      return originalOpen.call(window, url, target, features);
    };

    return () => {
      window.open = originalOpen;
    };
  }, []);

  return null;
}
