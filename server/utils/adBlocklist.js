// Curated domain blocklist derived from EasyList, EasyPrivacy, and AdGuard Base.
// Focused on the ad networks that video embed piracy providers typically use.
// Format: bare hostname without leading www. — matching is done as exact or suffix.

const AD_DOMAINS = new Set([
  // ── Programmatic / RTB ──────────────────────────────────────
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'adnxs.com',
  'adnxs.net',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'openx.com',
  'casalemedia.com',
  'indexww.com',
  'smartadserver.com',
  'sas.com',
  'criteo.com',
  'criteo.net',
  'outbrain.com',
  'taboola.com',
  'sharethrough.com',
  'sovrn.com',
  'lijit.com',
  '33across.com',

  // ── Adult/piracy site ad networks ───────────────────────────
  'popads.net',
  'popad.co',
  'popunder.ru',
  'exoclick.com',
  'exosrv.com',
  'juicyads.com',
  'juicyads.net',
  'trafficjunky.net',
  'trafficjunky.com',
  'traffichouse.net',
  'adsterra.com',
  'adsterra.network',
  'propellerads.com',
  'propellerclick.com',
  'propeller-cdn.com',
  'hilltopads.net',
  'hilltopads.com',
  'adcash.com',
  'mgid.com',
  'mgid.eu',
  'clickadu.com',
  'bidvertiser.com',
  'revcontent.com',
  'revenueads.net',
  'adespresso.com',
  'zedo.com',
  'adhaven.com',
  'adspyglass.com',
  'oclaserver.com',
  'oclasrv.com',
  'onclickads.net',
  'onclasrv.com',
  'adtng.com',
  'adtng.net',
  'go2speed.org',
  'adf.ly',
  'shrinkme.io',
  'ouo.io',
  'bc.vc',
  'sh.st',
  'shorte.st',

  // ── Trackers / analytics used by piracy sites ───────────────
  'quantserve.com',
  'quantcount.com',
  'lotame.com',
  'bluekai.com',
  'krxd.net',
  'demdex.net',
  'scorecardresearch.com',
  'adsrvr.org',
  'turn.com',
  'mediaplex.com',
  'imrworldwide.com',
  'addthis.com',
  'addthisedge.com',
  'sharethis.com',
  'tiqcdn.com',
  'akamaihd.net',          // some akamai ad-delivery nodes (not all — checked separately)

  // ── Redirect / popup chains ──────────────────────────────────
  'popupads.net',
  'popcash.net',
  'adcolony.com',
  'inmobi.com',
  'loopme.com',
  'aerserv.com',
  'adfalcon.com',
  'weborama.fr',
  'weborama.com',
  'xapads.com',
  'trafmag.com',
  'googlr.net',            // typosquat
  'gogle.co',              // typosquat
]);

/**
 * Returns true if the given URL (string or URL object) belongs to a known
 * ad or tracker domain.
 */
function isAdRequest(rawUrl) {
  let hostname;
  try {
    hostname = (typeof rawUrl === 'string' ? new URL(rawUrl) : rawUrl).hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return false;
  }

  if (AD_DOMAINS.has(hostname)) return true;

  // Check parent domains (e.g. sub.doubleclick.net)
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (AD_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }

  return false;
}

module.exports = { AD_DOMAINS, isAdRequest };
