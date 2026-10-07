// Netflix-style personalization for movies and TV: recommendations driven by
// what this profile actually watched and how they rated it.
//
//   1. History  — ratings (explicit, signed: a 1★ pushes similar titles
//                 down), Continue Watching + episodes watched (implicit,
//                 scaled by how much they binged), and watchlist status.
//                 Newest activity dominates via a rank + time decay.
//   2. Seeds    — the strongest recent positives become "Because you
//                 watched X" seeds. Each seed pulls TMDB's own
//                 recommendations for that exact title (co-watch based,
//                 far better than genre matching alone).
//   3. Taste    — weighted genre and original-language profile, used both
//                 to score candidates and to order the browse rows so a
//                 K-drama fan sees K-dramas near the top.
//   4. Scoring  — seed support + taste similarity + quality, minus
//                 disliked-genre overlap; already-watched, rated, saved
//                 and unreleased titles are excluded; light diversity
//                 re-ranking keeps one genre from taking over the row.
//
// Everything is matched back to catalog rows (catalogLookup) so every card
// opens a real title page.
import {
  fetchSupabaseRatings,
  fetchSupabaseWatchlist,
  fetchSupabaseContinueWatching,
  fetchEpisodeProgressCounts,
  averageRatingValue,
} from './supabaseData';
import {
  fetchDiscover,
  fetchTmdbRecommendations,
  fetchTmdbSimilar,
  genreNamesFromIds,
  languageName,
  tmdbGenreId,
  tmdbIdFromItem,
} from './tmdb';
import { resolveTmdbItems } from './catalogLookup';
import { identityKey } from './mediaIdentity';
import { getActiveProfileId } from './activeProfile';

const SEEDS_PER_TYPE = 6;
const TOP_PICKS = 24;
const CACHE_TTL_MS = 10 * 60 * 1000;

const TYPE_NOUN = { movie: 'movie', tv_show: 'series' };

function splitGenres(value) {
  return String(value || '').split(',').map((genre) => genre.trim()).filter(Boolean);
}

// Recency by order (history arrives newest-first) times a slow calendar
// decay, so the last few things watched steer the picks even for someone
// with hundreds of older ratings.
function recencyWeight(rank, dateStr) {
  const byRank = Math.max(0.12, Math.pow(0.82, rank));
  if (!dateStr) return byRank * 0.7;
  const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  const byTime = Number.isFinite(days) && days > 0 ? Math.max(0.3, Math.pow(0.5, days / 240)) : 1;
  return byRank * byTime;
}

// Rating (1–5) -> signed preference: 5★ ≈ +1.5, 3★ ≈ +0.2, 1★ ≈ -1.2.
function ratingPolarity(strength) {
  if (strength >= 4.5) return 1.5;
  if (strength >= 4) return 1.15;
  if (strength >= 3.5) return 0.6;
  if (strength >= 3) return 0.2;
  if (strength >= 2) return -0.6;
  return -1.2;
}

const WATCHLIST_POLARITY = {
  watched: 0.9,
  watching: 0.8,
  plan_to_watch: 0.35,
};

// One entry per title, merging every way the profile touched it.
function buildHistory({ ratings, watchlist, continueWatching, episodeCounts }) {
  const byKey = new Map();

  function touch(record, patch) {
    if (record.media_type !== 'movie' && record.media_type !== 'tv_show') return;
    const key = `${record.media_type}:${record.media_id}`;
    const existing = byKey.get(key) || {
      key,
      mediaType: record.media_type,
      mediaId: Number(record.media_id),
      title: record.title,
      genre: record.genre,
      language: record.original_language || null,
      tmdbId: tmdbIdFromItem(record),
      polarity: 0,
      weight: 0,
      rated: null,
      watched: false,
      saved: false,
    };
    Object.assign(existing, patch(existing));
    byKey.set(key, existing);
  }

  ratings.forEach((rating, rank) => {
    const strength = averageRatingValue(rating);
    touch(rating, (entry) => ({
      rated: strength,
      watched: true,
      polarity: ratingPolarity(strength),
      weight: Math.max(entry.weight, recencyWeight(rank, rating.created_at) * 1.25),
    }));
  });

  continueWatching.forEach((item, rank) => {
    const episodes = episodeCounts.get(Number(item.media_id)) || 0;
    // Binging is the strongest implicit signal: 1 ep ≈ 0.7, 10+ eps ≈ 1.2.
    const binge = item.media_type === 'tv_show' ? Math.min(0.5, episodes * 0.05) : 0;
    touch(item, (entry) => ({
      watched: true,
      polarity: entry.rated != null ? entry.polarity : 0.7 + binge,
      weight: Math.max(entry.weight, recencyWeight(rank, item.updated_at)),
    }));
  });

  watchlist.forEach((item, rank) => {
    touch(item, (entry) => ({
      saved: true,
      watched: entry.watched || item.status === 'watched' || item.status === 'watching',
      polarity: entry.rated != null || entry.watched ? entry.polarity : (WATCHLIST_POLARITY[item.status] ?? 0.3),
      weight: Math.max(entry.weight, recencyWeight(rank, item.updated_at || item.added_at) * 0.8),
    }));
  });

  return [...byKey.values()];
}

function addWeight(map, key, amount) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function buildTaste(history) {
  const genres = new Map();
  const languages = new Map();
  const dislikedGenres = new Map();
  const types = new Map();

  history.forEach((entry) => {
    const signal = entry.polarity * entry.weight;
    if (signal > 0) {
      splitGenres(entry.genre).forEach((genre) => addWeight(genres, genre, signal));
      addWeight(languages, entry.language, signal);
      addWeight(types, entry.mediaType, signal);
    } else if (signal < 0) {
      splitGenres(entry.genre).forEach((genre) => addWeight(dislikedGenres, genre, -signal));
    }
  });

  const normalize = (map) => {
    const max = Math.max(0, ...map.values());
    return max > 0 ? new Map([...map].map(([key, value]) => [key, value / max])) : new Map();
  };

  return {
    genres: normalize(genres),
    languages: normalize(languages),
    dislikedGenres: normalize(dislikedGenres),
    types: normalize(types),
  };
}

function rankedKeys(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key]) => key);
}

function candidateGenres(candidate) {
  const names = splitGenres(candidate.genre);
  return names.length ? names : genreNamesFromIds(candidate._tmdb?.genreIds || []);
}

function scoreCandidate(candidate, taste) {
  const genres = candidateGenres(candidate);
  let genreAffinity = 0;
  let dislike = 0;
  genres.forEach((genre) => {
    genreAffinity += taste.genres.get(genre) || 0;
    dislike += taste.dislikedGenres.get(genre) || 0;
  });
  if (genres.length) {
    genreAffinity /= Math.sqrt(genres.length);
    dislike /= Math.sqrt(genres.length);
  }

  const language = candidate.original_language || candidate._tmdb?.originalLanguage;
  const languageAffinity = language ? (taste.languages.get(language) || 0) : 0;

  const vote = Number(candidate._tmdb?.voteAverage || candidate.vote_average) || 0;
  const popularity = Number(candidate._tmdb?.popularity || candidate.popularity) || 0;
  const quality = Math.min(vote, 9) / 9;
  const buzz = Math.min(1, Math.log10(1 + popularity) / 3);

  return (candidate._seedScore || 0) * 1.6
    + genreAffinity * 0.9
    + languageAffinity * 0.7
    + quality * 0.45
    + buzz * 0.25
    + (candidate._collab || 0) * 0.6
    - dislike * 0.8;
}

// Light MMR: after a genre already holds 3 slots near the top, further
// titles whose primary genre matches it are nudged down.
function diversify(items) {
  const counts = new Map();
  return items
    .map((item) => {
      const primary = candidateGenres(item)[0] || '';
      const seen = counts.get(primary) || 0;
      counts.set(primary, seen + 1);
      return { item, adjusted: item._score - Math.max(0, seen - 2) * 0.18 };
    })
    .sort((a, b) => b.adjusted - a.adjusted)
    .map(({ item }) => item);
}

function matchPercent(score, maxScore) {
  if (!(maxScore > 0)) return null;
  return Math.round(Math.max(55, Math.min(98, 58 + (score / maxScore) * 40)));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.media_type}|${identityKey(item)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadHistory() {
  const [ratings, watchlist, continueWatching, episodeCounts] = await Promise.all([
    fetchSupabaseRatings().catch(() => []),
    fetchSupabaseWatchlist().catch(() => []),
    fetchSupabaseContinueWatching().catch(() => []),
    fetchEpisodeProgressCounts().catch(() => new Map()),
  ]);
  return buildHistory({ ratings, watchlist, continueWatching, episodeCounts });
}

function excludedKeySet(history) {
  // Anything already rated, watched, in progress or saved — the point of
  // these rows is discovering something new.
  return new Set(history.map((entry) => `${entry.mediaType}:${entry.mediaId}`));
}

function seedsFor(history, mediaType) {
  return history
    .filter((entry) => entry.mediaType === mediaType && entry.tmdbId && entry.polarity >= 0.6)
    .sort((a, b) => (b.polarity * b.weight) - (a.polarity * a.weight))
    .slice(0, SEEDS_PER_TYPE);
}

function seedReason(seed) {
  if (seed.rated != null && seed.rated >= 4.5) return `Because you loved ${seed.title}`;
  if (seed.rated != null) return `Because you rated ${seed.title}`;
  return `Because you watched ${seed.title}`;
}

async function candidatesForType(mediaType, history, taste, { kidsSafe }) {
  const excluded = excludedKeySet(history);
  const seeds = seedsFor(history, mediaType);
  const negativeSeeds = history.filter((entry) => entry.mediaType === mediaType && entry.tmdbId && entry.polarity < 0);

  const [seedLists, negativeLists] = await Promise.all([
    Promise.all(seeds.map(async (seed) => {
      let list = await fetchTmdbRecommendations(mediaType, seed.tmdbId);
      if (!list || list.length < 8) {
        const similar = await fetchTmdbSimilar(mediaType, seed.tmdbId);
        list = [...(list || []), ...(similar || [])];
      }
      return { seed, list: list || [] };
    })),
    Promise.all(negativeSeeds.slice(0, 3).map((seed) => fetchTmdbRecommendations(mediaType, seed.tmdbId).then((list) => list || []))),
  ]);

  // Taste-based discovery so someone with one or two seeds still gets a
  // full row: their top genres, in their top non-English language if they
  // clearly lean on one (the K-drama case).
  const topGenres = rankedKeys(taste.genres, 2).map(tmdbGenreId).filter(Boolean);
  const topLanguage = rankedKeys(taste.languages, 1)[0];
  const discoverParams = { 'vote_count.gte': mediaType === 'movie' ? '150' : '60' };
  if (topLanguage && topLanguage !== 'en' && (taste.languages.get(topLanguage) || 0) >= 0.5) {
    discoverParams.with_original_language = topLanguage;
  }
  const discoverLists = await Promise.all(
    (topGenres.length ? topGenres : [null]).map((genreId) => fetchDiscover(mediaType, genreId ? { ...discoverParams, with_genres: String(genreId) } : discoverParams))
  );

  const pool = new Map();
  function addCandidate(result, seedScore, seed) {
    if (!result?.tmdbId) return;
    const existing = pool.get(result.tmdbId) || { tmdb: result, seedScore: 0, bestSeed: null, bestSeedScore: 0 };
    existing.seedScore += seedScore;
    if (seed && seedScore > existing.bestSeedScore) {
      existing.bestSeed = seed;
      existing.bestSeedScore = seedScore;
    }
    pool.set(result.tmdbId, existing);
  }

  seedLists.forEach(({ seed, list }) => {
    const seedStrength = seed.polarity * seed.weight;
    list.forEach((result, index) => addCandidate(result, seedStrength * (1 - index / 40), seed));
  });
  discoverLists.forEach((list) => (list || []).forEach((result, index) => addCandidate(result, 0.12 * (1 - index / 40), null)));

  const negativeIds = new Set(negativeLists.flat().map((result) => result.tmdbId));

  const items = await resolveTmdbItems(
    [...pool.values()].map((entry) => entry.tmdb),
    mediaType,
    { kidsSafe }
  );

  const maxSeed = Math.max(0.0001, ...[...pool.values()].map((entry) => entry.seedScore));

  const scored = items
    .filter((item) => !excluded.has(`${mediaType}:${item.id}`))
    .map((item) => {
      const entry = pool.get(item._tmdb?.tmdbId);
      const candidate = {
        ...item,
        _seedScore: entry ? entry.seedScore / maxSeed : 0,
        _seed: entry?.bestSeed || null,
      };
      if (negativeIds.has(item._tmdb?.tmdbId)) candidate._seedScore -= 0.4;
      candidate._score = scoreCandidate(candidate, taste);
      return candidate;
    });

  return { scored, seeds, seedLists };
}

function reasonFor(item, taste) {
  if (item._seed) return seedReason(item._seed);
  const language = item.original_language || item._tmdb?.originalLanguage;
  if (language && language !== 'en' && (taste.languages.get(language) || 0) >= 0.5) {
    return `Popular ${languageName(language)} ${TYPE_NOUN[item.media_type] || 'title'} for you`;
  }
  const genre = candidateGenres(item).find((name) => (taste.genres.get(name) || 0) >= 0.4);
  return genre ? `Matches your taste for ${genre}` : 'Highly rated and popular right now';
}

function finalizeRow(items, taste) {
  const ranked = diversify(dedupe([...items].sort((a, b) => b._score - a._score)));
  const maxScore = ranked[0]?._score || 0;
  return ranked.map((item) => ({
    ...item,
    _match: matchPercent(item._score, maxScore),
    _reason: reasonFor(item, taste),
  }));
}

function becauseRows(seedLists, scoredByTmdbId, taste, limit) {
  return seedLists
    .map(({ seed, list }) => {
      const items = list
        .map((result) => scoredByTmdbId.get(result.tmdbId))
        .filter(Boolean);
      return {
        id: `because-${seed.key}`,
        title: seedReason(seed),
        seed,
        items: finalizeRow(items, taste).map((item) => ({ ...item, _reason: seedReason(seed) })),
      };
    })
    .filter((row) => row.items.length >= 5)
    .slice(0, limit);
}

const resultCache = new Map();

function cacheKeyFor(mediaTypes, kidsSafe) {
  return `${getActiveProfileId() || 'default'}|${mediaTypes.join(',')}|${kidsSafe ? 'kids' : 'all'}`;
}

// Invalidate whenever the profile's history changes (rating saved etc.).
if (typeof window !== 'undefined') {
  ['binge:ratingSaved', 'binge:historyChanged'].forEach((eventName) => {
    window.addEventListener(eventName, () => resultCache.clear());
  });
}

export function clearPersonalizationCache() {
  resultCache.clear();
}

/**
 * Personalized rows for one or both video types.
 *
 * @returns {{
 *   hasHistory: boolean,
 *   topPicks: object[],          // ranked catalog items with _match/_reason
 *   becauseYouWatched: {id, title, items}[],
 *   taste: { genres: string[], languages: string[] },
 * }}
 */
export async function buildPersonalizedRows({ mediaTypes = ['movie', 'tv_show'], kidsSafe = false, becauseLimit = 3 } = {}) {
  const key = cacheKeyFor(mediaTypes, kidsSafe);
  const cached = resultCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const history = await loadHistory();
  const taste = buildTaste(history);
  const hasHistory = history.some((entry) => entry.polarity > 0);

  if (!hasHistory) {
    const value = {
      hasHistory: false,
      topPicks: [],
      becauseYouWatched: [],
      taste: { genres: [], languages: [] },
    };
    resultCache.set(key, { ts: Date.now(), value });
    return value;
  }

  const perType = await Promise.all(
    mediaTypes.map((mediaType) => candidatesForType(mediaType, history, taste, { kidsSafe }))
  );

  // Weight each type by how much of the profile's positive history it is,
  // so a mostly-TV viewer's mixed Top Picks lean TV.
  const allScored = perType.flatMap(({ scored }, index) => {
    const typeWeight = 0.75 + 0.25 * (taste.types.get(mediaTypes[index]) || 0);
    return scored.map((item) => ({ ...item, _score: item._score * typeWeight }));
  });

  const topPicks = finalizeRow(allScored, taste).slice(0, TOP_PICKS);

  const scoredByTmdbId = new Map();
  perType.forEach(({ scored }) => scored.forEach((item) => {
    if (item._tmdb?.tmdbId) scoredByTmdbId.set(`${item.media_type}:${item._tmdb.tmdbId}`, item);
  }));

  const because = perType.flatMap(({ seedLists }, index) => {
    const mediaType = mediaTypes[index];
    const lookup = new Map([...scoredByTmdbId].filter(([k]) => k.startsWith(`${mediaType}:`)).map(([k, v]) => [Number(k.split(':')[1]), v]));
    return becauseRows(seedLists, lookup, taste, becauseLimit);
  });

  // Interleave seeds by recency/strength rather than all-movies-then-all-TV.
  because.sort((a, b) => (b.seed.polarity * b.seed.weight) - (a.seed.polarity * a.seed.weight));

  const value = {
    hasHistory: true,
    topPicks,
    becauseYouWatched: because.slice(0, becauseLimit),
    taste: {
      genres: rankedKeys(taste.genres, 8),
      languages: rankedKeys(taste.languages, 4).filter(Boolean),
    },
  };
  resultCache.set(key, { ts: Date.now(), value });
  return value;
}

