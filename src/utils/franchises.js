// Franchise watch order. A few big franchises are curated (TMDB has no
// "story order", and the MCU isn't one TMDB collection — it's split into
// Iron Man / Thor / … collections); everything else uses the movie's TMDB
// collection in release order. All ids verified against TMDB.
import { normalizeTmdbResult, tmdbGet } from './tmdb';

export const CURATED_FRANCHISES = {
  mcu: {
    name: 'Marvel Cinematic Universe',
    // Release order.
    release: [1726, 1724, 10138, 10195, 1771, 24428, 68721, 76338, 100402, 118340, 99861, 102899, 271110, 284052, 283995,
      315635, 284053, 284054, 299536, 363088, 299537, 299534, 429617, 497698, 566525, 524434, 634649, 453395, 616037,
      505642, 640146, 447365, 609681, 533535, 822119, 986056, 617126],
    // Story (timeline) order, as Disney+ lists it.
    story: [1771, 299537, 1726, 10138, 1724, 10195, 24428, 76338, 68721, 100402, 118340, 283995, 99861, 102899, 271110,
      497698, 284054, 315635, 284052, 284053, 363088, 299536, 299534, 429617, 566525, 524434, 634649, 453395, 616037,
      505642, 447365, 640146, 609681, 533535, 822119, 986056, 617126],
  },
  starwars: {
    name: 'Star Wars',
    release: [11, 1891, 1892, 1893, 1894, 1895, 140607, 330459, 181808, 348350, 181812],
    story: [1893, 1894, 1895, 348350, 330459, 11, 1891, 1892, 140607, 181808, 181812],
  },
  fast: {
    name: 'Fast & Furious',
    release: [9799, 584, 9615, 13804, 51497, 82992, 168259, 337339, 384018, 385128, 385687],
    // Tokyo Drift happens after Fast & Furious 6.
    story: [9799, 584, 13804, 51497, 82992, 9615, 168259, 337339, 384018, 385128, 385687],
  },
};

export function curatedFranchiseFor(tmdbId) {
  const id = Number(tmdbId);
  return Object.entries(CURATED_FRANCHISES).find(([, franchise]) => franchise.release.includes(id)) || null;
}

async function movieResult(id) {
  const data = await tmdbGet(`/movie/${id}`);
  return data ? normalizeTmdbResult({ ...data, media_type: 'movie' }, 'movie') : null;
}

// { key, name, release: [tmdb results], story: [tmdb results] | null } or null.
export async function findFranchise(tmdbId) {
  const curated = curatedFranchiseFor(tmdbId);
  if (curated) {
    const [key, franchise] = curated;
    const results = await Promise.all(franchise.release.map(movieResult));
    const byId = new Map(results.filter(Boolean).map((result) => [result.tmdbId, result]));
    const pick = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
    return { key, name: franchise.name, release: pick(franchise.release), story: pick(franchise.story) };
  }

  const details = await tmdbGet(`/movie/${tmdbId}`);
  const collectionId = details?.belongs_to_collection?.id;
  if (!collectionId) return null;
  const collection = await tmdbGet(`/collection/${collectionId}`);
  const parts = (collection?.parts || [])
    .filter((part) => part.release_date)
    .sort((a, b) => a.release_date.localeCompare(b.release_date))
    .map((part) => normalizeTmdbResult({ ...part, media_type: 'movie' }, 'movie'));
  if (parts.length < 2) return null;
  return {
    key: `collection:${collectionId}`,
    name: String(collection.name || '').replace(/\s+collection$/i, ''),
    release: parts,
    story: null,
  };
}
