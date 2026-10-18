// Picks the right resolution for every artwork surface.
//
// Catalog posters are TMDB w500 (fine for cards); heroes and the detail
// modal need far more on a 2x display, so TMDB URLs are rewritten to the
// size the slot actually needs, with a srcset so the browser picks per
// screen. Goodreads covers embed a thumbnail size token (`._SY75_`,
// `._SX50_SY75_`...) — stripping it serves the full-size cover.

const TMDB_SIZE = /\/t\/p\/(w\d+|original)\//;

function unwrapPlex(url) {
  try {
    if (url.includes('plex.tv')) {
      const inner = new URL(url).searchParams.get('url');
      if (inner) {
        try { return decodeURIComponent(inner); } catch { return inner; }
      }
    }
  } catch {
    return url;
  }
  return url;
}

export function isTmdbImage(url) {
  return typeof url === 'string' && url.includes('image.tmdb.org') && TMDB_SIZE.test(url);
}

export function tmdbResize(url, size) {
  return isTmdbImage(url) ? url.replace(TMDB_SIZE, `/t/p/${size}/`) : url;
}

function fullSizeGoodreads(url) {
  return url.replace(/\._S[XY]\d+(_S[XY]\d+)?_(?=\.)/i, '');
}

// Best single URL for a poster/cover slot.
export function posterSrc(url) {
  if (!url) return null;
  const raw = unwrapPlex(String(url));
  if (/gr-assets\.com|goodreads/i.test(raw)) return fullSizeGoodreads(raw);
  if (/covers\.openlibrary\.org\/b\/.*-[SM]\.jpg$/i.test(raw)) return raw.replace(/-[SM]\.jpg$/i, '-L.jpg');
  return raw;
}

// srcset for a 2:3 poster rendered roughly `cssWidth` px wide.
export function posterSrcSet(url) {
  const src = posterSrc(url);
  if (!isTmdbImage(src)) return undefined;
  return ['w342 342w', 'w500 500w', 'w780 780w']
    .map((entry) => `${tmdbResize(src, entry.split(' ')[0])} ${entry.split(' ')[1]}`)
    .join(', ');
}

// Wide backdrop for heroes / the detail modal header.
export function backdropSrc(url, size = 'w1280') {
  if (!url) return null;
  return tmdbResize(unwrapPlex(String(url)), size);
}

export function backdropSrcSet(url) {
  const src = backdropSrc(url);
  if (!isTmdbImage(src)) return undefined;
  return `${tmdbResize(src, 'w780')} 780w, ${tmdbResize(src, 'w1280')} 1280w, ${tmdbResize(src, 'original')} 2400w`;
}
