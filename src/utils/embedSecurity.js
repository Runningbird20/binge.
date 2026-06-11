const BLOCKED_HOST_PARTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.',
  'adsystem.com',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'popads.net',
  'propellerads.com',
  'onclick',
];

const BLOCKED_PATH_PARTS = [
  '/ads/',
  '/adserver',
  '/advert',
  '/banner',
  '/popunder',
  '/popup',
];

export function isBlockedAdUrl(value) {
  if (!value || typeof value !== 'string') return false;

  let url;
  try {
    url = new URL(value, window.location.href);
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const path = `${url.pathname}${url.search}`.toLowerCase();

  return (
    BLOCKED_HOST_PARTS.some((part) => host.includes(part)) ||
    BLOCKED_PATH_PARTS.some((part) => path.includes(part))
  );
}

