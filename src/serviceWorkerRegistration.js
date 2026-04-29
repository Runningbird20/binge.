const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '[::1]' ||
  /^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/.test(window.location.hostname)
);

export function register() {
  if (!('serviceWorker' in navigator)) return;

  const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
  if (publicUrl.origin !== window.location.origin) return;

  window.addEventListener('load', () => {
    const swUrl = `${process.env.PUBLIC_URL}/sw.js`;
    if (isLocalhost) {
      // On localhost, verify the SW exists before registering
      fetch(swUrl, { headers: { 'Service-Worker': 'script' } })
        .then((response) => {
          if (response.status === 404 || !response.headers.get('content-type')?.includes('javascript')) {
            navigator.serviceWorker.ready.then((reg) => reg.unregister());
          } else {
            navigator.serviceWorker.register(swUrl).catch(() => {});
          }
        })
        .catch(() => {});
    } else {
      navigator.serviceWorker.register(swUrl).catch(() => {});
    }
  });
}

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then((reg) => reg.unregister()).catch(() => {});
  }
}
