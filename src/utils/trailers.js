// YouTube trailer key for a title (TMDB /videos, cached by tmdb.js).
import { tmdbGet, tmdbIdFromItem, tmdbKind } from './tmdb';

export async function getTrailerKey(item) {
  const tmdbId = tmdbIdFromItem(item);
  if (!tmdbId || (item.media_type !== 'movie' && item.media_type !== 'tv_show')) return null;
  const data = await tmdbGet(`/${tmdbKind(item.media_type)}/${tmdbId}/videos`);
  const list = (data?.results || []).filter((video) => video.site === 'YouTube');
  const pick = list.find((v) => v.type === 'Trailer' && v.official)
    || list.find((v) => v.type === 'Trailer')
    || list.find((v) => v.type === 'Teaser');
  return pick?.key || null;
}

// Muted, chromeless, looping autoplay embed (YouTube's JS API enabled so
// the page can unmute it with a postMessage command).
export function trailerEmbedUrl(key, { start = 0 } = {}) {
  const params = new URLSearchParams({
    autoplay: '1', mute: '1', controls: '0', loop: '1', playlist: key, modestbranding: '1',
    playsinline: '1', rel: '0', iv_load_policy: '3', disablekb: '1', enablejsapi: '1', start: String(start),
  });
  return `https://www.youtube-nocookie.com/embed/${key}?${params}`;
}

export function setTrailerMuted(iframe, muted) {
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: muted ? 'mute' : 'unMute', args: [] }), '*');
}

// Autoplaying video only where it's welcome.
export function canAutoplayPreviews() {
  if (typeof window === 'undefined') return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const saveData = navigator.connection?.saveData;
  const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  return !reduce && !saveData && finePointer;
}

// YouTube shows its title bar and big pause button for the first couple of
// seconds of playback. Ask the player for state updates (JS API
// "listening" handshake) and call onReady once it has been playing long
// enough for that chrome to fade. Returns a cleanup function.
const CHROME_FADE_MS = 2200;

export function whenTrailerPlaying(iframe, onReady) {
  if (!iframe) return () => {};
  let timer = null;
  let done = false;
  function onMessage(event) {
    if (event.source !== iframe.contentWindow || done) return;
    let data = event.data;
    try { data = typeof data === 'string' ? JSON.parse(data) : data; } catch { return; }
    if (data?.info?.playerState === 1 && !timer) {
      timer = setTimeout(() => { done = true; onReady(); }, CHROME_FADE_MS);
    }
  }
  window.addEventListener('message', onMessage);
  iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
  // Fallback if the player never reports state (API blocked, slow network).
  const fallback = setTimeout(() => { if (!done) { done = true; onReady(); } }, 7000);
  return () => {
    window.removeEventListener('message', onMessage);
    clearTimeout(timer);
    clearTimeout(fallback);
  };
}
