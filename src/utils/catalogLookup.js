// Turns TMDB list results (trending, discover, recommendations, search)
// into catalog items the app can open: matched by TMDB id, filtered by the
// release-window rule, de-duplicated, and tagged with the TMDB data the
// cards and scorers use (`_tmdb`, `_comingSoon`).
import { fetchCatalogByTmdbIds } from './supabaseMovieCatalog';
import { tmdbImage } from './tmdb';
import { identityKey } from './mediaIdentity';
import { isBrowseable, isComingSoon } from './releaseWindow';

const matchCache = new Map();

const KIDS_SAFE_RATINGS = ['G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG'];
const KIDS_GENRE_IDS = [10751, 16, 10762]; // Family, Animation, Kids

// Many catalog rows have no age_rating, so for kids profiles an unrated
// title must also be tagged Family/Animation/Kids on TMDB — otherwise a
// "Because you watched" list could surface an unrated R-rated film.
function isKidsSafe(row, result) {
  if (row.age_rating) return KIDS_SAFE_RATINGS.includes(row.age_rating);
  return (result.genreIds || []).some((id) => KIDS_GENRE_IDS.includes(id));
}

async function lookup(mediaType, tmdbIds) {
  const missing = tmdbIds.filter((id) => !matchCache.has(`${mediaType}:${id}`));
  if (missing.length) {
    const found = await fetchCatalogByTmdbIds(mediaType, missing).catch(() => new Map());
    // Cache misses too (as null) so an unmatched TMDB title isn't re-queried
    // every time it shows up in a list.
    missing.forEach((id) => matchCache.set(`${mediaType}:${id}`, found.get(id) || null));
  }
  return tmdbIds.map((id) => matchCache.get(`${mediaType}:${id}`) || null);
}

export async function resolveTmdbItems(results = [], mediaType, { kidsSafe = false } = {}) {
  const usable = results.filter((result) => result?.tmdbId && isBrowseable({ releaseDate: result.releaseDate }));
  if (!usable.length) return [];

  const matches = await lookup(mediaType, usable.map((result) => result.tmdbId));
  const seen = new Set();
  const items = [];

  usable.forEach((result, index) => {
    const row = matches[index];
    if (!row) return;
    if (kidsSafe && !isKidsSafe(row, result)) return;

    const item = {
      ...row,
      media_type: mediaType,
      poster_url: row.poster_url || tmdbImage(result.posterPath),
      backdrop_url: tmdbImage(result.backdropPath, 'w1280'),
      release_date: row.release_date || result.releaseDate,
      original_language: row.original_language || result.originalLanguage,
      overview: result.overview || row.overview,
      _tmdb: result,
    };
    if (!isBrowseable(item)) return;
    item._comingSoon = isComingSoon(item);

    const key = identityKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  });

  return items;
}

// Same treatment for rows that came straight from the catalog tables.
export function prepareCatalogItems(rows = [], mediaType) {
  const seen = new Set();
  return rows
    .map((row) => ({ ...row, media_type: mediaType }))
    .filter((item) => {
      if (!isBrowseable(item)) return false;
      const key = identityKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({ ...item, _comingSoon: isComingSoon(item) }));
}
