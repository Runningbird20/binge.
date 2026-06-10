import { useEffect } from 'react';
import { isBlockedAdUrl } from '../utils/embedSecurity';

const HIDDEN_AD_SELECTORS = [
  '[id^="google_ads_"]',
  '[id*="ad-banner" i]',
  '[id*="ad_container" i]',
  '[class*="ad-banner" i]',
  '[class*="ad_container" i]',
  '[class*="ad-slot" i]',
  '[class*="ad-wrapper" i]',
  '[aria-label="advertisement" i]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="googleadservices.com"]',
];

function markAdNodes(root = document) {
  HIDDEN_AD_SELECTORS.forEach((selector) => {
    root.querySelectorAll?.(selector).forEach((node) => {
      node.setAttribute('data-binge-adblocked', 'true');
    });
  });
}

export default function AdBlocker() {
  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.bingeAdBlocker = 'true';
    style.textContent = `
      ${HIDDEN_AD_SELECTORS.join(',\n')},
      [data-binge-adblocked="true"] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);

    const originalOpen = window.open;
    window.open = function blockedWindowOpen(url, target, features) {
      if (!url || isBlockedAdUrl(String(url))) return null;
      return originalOpen.call(window, url, target, features);
    };

    const originalFetch = window.fetch;
    window.fetch = function blockedFetch(input, init) {
      const url = typeof input === 'string' ? input : input?.url;
      if (isBlockedAdUrl(url)) {
        return Promise.reject(new DOMException('Blocked by Binge ad blocker', 'AbortError'));
      }
      return originalFetch.call(window, input, init);
    };

    const originalOpenXhr = window.XMLHttpRequest?.prototype?.open;
    if (originalOpenXhr) {
      window.XMLHttpRequest.prototype.open = function blockedXhrOpen(method, url, ...rest) {
        if (isBlockedAdUrl(url)) {
          throw new DOMException('Blocked by Binge ad blocker', 'AbortError');
        }
        return originalOpenXhr.call(this, method, url, ...rest);
      };
    }

    function onDocumentClick(event) {
      const link = event.target?.closest?.('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (isBlockedAdUrl(href)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    markAdNodes();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) markAdNodes(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', onDocumentClick, true);

    return () => {
      document.removeEventListener('click', onDocumentClick, true);
      observer.disconnect();
      window.open = originalOpen;
      window.fetch = originalFetch;
      if (originalOpenXhr) {
        window.XMLHttpRequest.prototype.open = originalOpenXhr;
      }
      style.remove();
    };
  }, []);

  return null;
}
