// "Smart downloads" for phones: while the app is idle on a good connection,
// fetch what the next episodes of Continue Watching need — their details,
// season list and artwork — so they open instantly (or at all) on a flaky
// connection later. The service worker keeps the copies (public/sw.js:
// images cache-first, TMDB data network-first with a fallback). The video
// itself can't be saved: embed servers stream it.
import { tmdbGet, tmdbIdFromItem, tmdbImage } from './tmdb';
import { getSettings } from './profileSettings';

const MAX_TITLES = 6;
const done = new Set();

export function shouldPrecache() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (getSettings().dataSaver) return false;
  const connection = navigator.connection;
  if (connection?.saveData) return false;
  if (connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) return false;
  return true;
}

function warmImage(url) {
  if (!url || done.has(url)) return;
  done.add(url);
  const image = new Image();
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.src = url;
}

export function precacheUpNext(items = []) {
  if (!shouldPrecache()) return;
  const run = async () => {
    for (const item of items.slice(0, MAX_TITLES)) {
      const tmdbId = tmdbIdFromItem(item);
      const key = `${item.media_type}:${tmdbId}:${item.current_season}:${item.current_episode}`;
      if (!tmdbId || done.has(key)) continue;
      done.add(key);
      warmImage(item.poster_url || item.image_url);
      if (item.media_type !== 'tv_show') {
        const details = await tmdbGet(`/movie/${tmdbId}`).catch(() => null);
        warmImage(tmdbImage(details?.backdrop_path, 'w780'));
        continue;
      }
      const details = await tmdbGet(`/tv/${tmdbId}`).catch(() => null);
      warmImage(tmdbImage(details?.backdrop_path, 'w780'));
      const season = Number(item.current_season) || 1;
      const seasonData = await tmdbGet(`/tv/${tmdbId}/season/${season}`).catch(() => null);
      const next = (seasonData?.episodes || []).find((ep) => ep.episode_number === (Number(item.current_episode) || 1) + 1);
      warmImage(tmdbImage(next?.still_path, 'w300'));
    }
  };
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500));
  idle(() => { run().catch(() => {}); });
}
