import {
  fetchSupabaseRatings,
  fetchSupabaseWatchlist,
} from './supabaseData';
import {
  fetchSupabaseBooksPage,
  fetchSupabaseMovieCatalogSegment,
  fetchSupabaseTvShowCatalogSegment,
} from './supabaseMovieCatalog';

const THIS_YEAR = new Date().getFullYear();

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function splitGenres(value) {
  return String(value || '')
    .split(',')
    .map((genre) => genre.trim())
    .filter(Boolean);
}

function getRatingStrength(rating) {
  const numericValues = Object.entries(rating || {})
    .filter(([key]) => !['id', 'user_id', 'media_id', 'review', 'created_at', 'media_type', 'title', 'year', 'genre', 'image_url'].includes(key))
    .map(([, value]) => Number(value))
    .filter(Number.isFinite);

  return average(numericValues);
}

// Watchlist status has no 1-5 scale, so map it onto the same strength axis ratings use.
function watchlistStrength(status) {
  if (status === 'watched' || status === 'read') return 4.5;
  if (status === 'watching' || status === 'reading') return 4.0;
  if (status === 'plan_to_watch' || status === 'plan_to_read') return 3.3;
  return 3.0;
}

// Recent activity should outweigh old activity so recs track taste as it changes,
// but old signals still count a little (floor) rather than dropping off a cliff.
function decayWeight(dateStr, halfLifeDays = 120) {
  if (!dateStr) return 0.6;
  const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  if (!Number.isFinite(days) || days < 0) return 1;
  return Math.max(0.25, Math.pow(0.5, days / halfLifeDays));
}

function buildSignals(ratings, watchlist) {
  const ratingSignals = ratings.map((rating) => ({
    mediaType: rating.media_type,
    title: rating.title,
    genre: rating.genre,
    rawStrength: getRatingStrength(rating),
    weight: decayWeight(rating.created_at),
  }));

  const watchlistSignals = watchlist.map((item) => ({
    mediaType: item.media_type,
    title: item.title,
    genre: item.genre,
    rawStrength: watchlistStrength(item.status),
    weight: decayWeight(item.updated_at || item.added_at, 200),
  }));

  return [...ratingSignals, ...watchlistSignals];
}

function weightedGenreCounts(signals, mediaType = null) {
  const counts = new Map();
  signals.forEach((signal) => {
    if (mediaType && signal.mediaType !== mediaType) return;
    if (signal.rawStrength < 3.2) return;
    splitGenres(signal.genre).forEach((genre) => {
      counts.set(genre, (counts.get(genre) || 0) + signal.weight);
    });
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([genre]) => genre);
}

const TYPE_LABELS = { movie: 'movies', tv_show: 'TV shows', book: 'books' };

function buildTasteProfile(signals, mediaType = null) {
  const relevant = mediaType ? signals.filter((signal) => signal.mediaType === mediaType) : signals;
  const positive = relevant.filter((signal) => signal.rawStrength >= 4);

  if (!positive.length) {
    return mediaType
      ? `You haven't rated or tracked much in ${TYPE_LABELS[mediaType]} yet, so these lean on your activity elsewhere plus overall quality.`
      : 'You have started building your library, but there is not enough strong preference data yet. Rate a few titles or mark some as watched and your recommendations will sharpen up.';
  }

  const favoriteGenres = weightedGenreCounts(positive, mediaType).slice(0, 3);

  if (mediaType) {
    if (!favoriteGenres.length) {
      return `These lean into the ${TYPE_LABELS[mediaType]} you've rated and tracked most positively.`;
    }
    return `Lately you've been gravitating toward ${favoriteGenres.join(', ')} in ${TYPE_LABELS[mediaType]}. These picks are pulled from your most recent activity, not just your all-time history.`;
  }

  const typeWeights = new Map();
  positive.forEach((signal) => {
    typeWeights.set(signal.mediaType, (typeWeights.get(signal.mediaType) || 0) + signal.weight);
  });
  const favoriteTypes = [...typeWeights.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([label]) => TYPE_LABELS[label]);

  if (!favoriteGenres.length) {
    return `You tend to enjoy ${favoriteTypes.join(' and ')} lately, so these picks lean into the parts of that library you seem to enjoy most.`;
  }

  return `Lately you've been gravitating toward ${favoriteGenres.join(', ')}, especially in ${favoriteTypes.join(' and ')}. These picks are pulled from your most recent ratings and watchlist activity, not just your all-time history.`;
}

function scoreCandidate(candidate, signals, excludedKeys) {
  const candidateKey = `${candidate.media_type}:${candidate.id}`;
  if (excludedKeys.has(candidateKey)) {
    return -Infinity;
  }

  const candidateGenres = splitGenres(candidate.genre);
  let score = 0;

  signals.forEach((signal) => {
    // Positive weight for liked/watched, negative for disliked/low-rated — recency-scaled either way.
    const polarity = signal.rawStrength >= 4 ? 1.5 : signal.rawStrength >= 3.2 ? 0.6 : -1.0;
    const weight = polarity * signal.weight;

    const sharedGenres = candidateGenres.filter((genre) => splitGenres(signal.genre).includes(genre));
    score += sharedGenres.length * 2.5 * weight;

    if (candidate.media_type === signal.mediaType && polarity > 0) {
      score += 0.6 * signal.weight;
    }
  });

  // Quality nudge from catalog metadata (movies only expose these columns today).
  const quality = Number(candidate.vote_average) || (Number(candidate.popularity) ? Math.min(Number(candidate.popularity), 100) / 10 : 0);
  if (quality) {
    score += Math.min(quality, 10) * 0.15;
  }

  // Slight recency bonus — prefer titles from last 20 years over very old ones.
  if (candidate.year) {
    const age = THIS_YEAR - Number(candidate.year);
    score += Math.max(0, (20 - age)) / 20;
  }

  // Jitter breaks ties differently on every call so refreshing surfaces new-but-relevant picks
  // instead of freezing on the exact same top-N forever.
  score *= 0.9 + Math.random() * 0.2;

  return score;
}

function buildRecommendationReason(candidate, signals) {
  const candidateGenres = splitGenres(candidate.genre);

  const matches = signals
    .map((signal) => ({
      signal,
      overlap: candidateGenres.filter((genre) => splitGenres(signal.genre).includes(genre)).length,
    }))
    .filter((match) => match.overlap > 0 && match.signal.rawStrength >= 3.2)
    .sort((a, b) => (b.overlap * b.signal.weight * b.signal.rawStrength) - (a.overlap * a.signal.weight * a.signal.rawStrength));

  const best = matches[0]?.signal;

  if (best?.title) {
    const sharedGenre = candidateGenres.find((genre) => splitGenres(best.genre).includes(genre));
    const verb = best.rawStrength >= 4.3 ? 'loved' : best.rawStrength >= 4 ? 'liked' : 'added';
    if (sharedGenre) {
      return `If you ${verb} the ${sharedGenre.toLowerCase()} in ${best.title}, this has the same energy.`;
    }
    return `Fans of ${best.title} tend to love this one too.`;
  }

  if (candidateGenres.length) {
    const topLiked = signals
      .filter((signal) => signal.rawStrength >= 4)
      .sort((a, b) => b.weight - a.weight)[0];
    if (topLiked?.title) {
      return `Based on how much you enjoyed ${topLiked.title}, this ${candidateGenres[0].toLowerCase()} pick should be right up your alley.`;
    }
    return `A strong pick from the ${candidateGenres.slice(0, 2).join(' / ').toLowerCase()} catalog based on your recent activity.`;
  }

  return 'A strong match based on the patterns in your recent activity.';
}

function dedupeById(items) {
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  });
  return out;
}

// Instead of always scoring the same alphabetically-first slice of the catalog, probe the
// genre-filtered count and jump to a random window within it — every call can reach the
// full catalog, not just the first page.
async function sampleCatalogSegment(fetchSegment, { genre = '', limit } = {}) {
  const probe = await fetchSegment({ genre, offset: 0, limit: 1, includeCount: true, includeFacets: false }).catch(() => null);
  const total = probe?.total || 0;
  if (!total) return [];

  const window = Math.min(limit, total);
  const maxOffset = Math.max(0, total - window);
  const offset = maxOffset > 0 ? Math.floor(Math.random() * (maxOffset + 1)) : 0;

  const page = await fetchSegment({ genre, offset, limit: window, includeCount: false, includeFacets: false }).catch(() => ({ items: [] }));
  return page.items || [];
}

async function sampleBookSegment({ genre = '', limit } = {}) {
  const probe = await fetchSupabaseBooksPage({ genre, page: 1, pageSize: 1 }).catch(() => null);
  const total = probe?.total || 0;
  if (!total) return [];

  const window = Math.min(limit, total);
  const totalPages = Math.max(1, Math.ceil(total / window));
  const page = 1 + Math.floor(Math.random() * totalPages);

  const result = await fetchSupabaseBooksPage({ genre, page, pageSize: window }).catch(() => ({ items: [] }));
  return result.items || [];
}

async function sampleMoviePool(genres) {
  const results = await Promise.all([
    sampleCatalogSegment(fetchSupabaseMovieCatalogSegment, { limit: 60 }),
    ...genres.map((genre) => sampleCatalogSegment(fetchSupabaseMovieCatalogSegment, { genre, limit: 60 })),
  ]);
  return dedupeById(results.flat());
}

async function sampleShowPool(genres) {
  const results = await Promise.all([
    sampleCatalogSegment(fetchSupabaseTvShowCatalogSegment, { limit: 60 }),
    ...genres.map((genre) => sampleCatalogSegment(fetchSupabaseTvShowCatalogSegment, { genre, limit: 60 })),
  ]);
  return dedupeById(results.flat());
}

async function sampleBookPool(genres) {
  const results = await Promise.all([
    sampleBookSegment({ limit: 40 }),
    ...genres.map((genre) => sampleBookSegment({ genre, limit: 40 })),
  ]);
  return dedupeById(results.flat());
}

const EMPTY_MESSAGE = 'Rate some movies, TV shows, or books — or add a few to your watchlist — to unlock personalized recommendations.';

async function prepareRecommendationContext() {
  const [ratings, watchlist] = await Promise.all([
    fetchSupabaseRatings(),
    fetchSupabaseWatchlist(),
  ]);

  if (!ratings.length && !watchlist.length) {
    return null;
  }

  const signals = buildSignals(ratings, watchlist);
  const excludedKeys = new Set([
    ...ratings.map((rating) => `${rating.media_type}:${rating.media_id}`),
    ...watchlist.map((item) => `${item.media_type}:${item.media_id}`),
  ]);

  return { signals, excludedKeys };
}

function topScored(items, mediaType, signals, excludedKeys, n) {
  return items
    .map((item) => ({ ...item, media_type: mediaType, _score: scoreCandidate({ ...item, media_type: mediaType }, signals, excludedKeys) }))
    .filter((candidate) => Number.isFinite(candidate._score) && candidate._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, n);
}

function toRecommendation(candidate, signals) {
  return {
    id: candidate.id,
    title: candidate.title,
    media_type: candidate.media_type,
    year: candidate.year,
    genre: candidate.genre,
    posterUrl: candidate.poster_url || candidate.cover_url || null,
    siteUrl:
      candidate.media_type === 'movie'
        ? `/movies?open=${candidate.id}`
        : candidate.media_type === 'tv_show'
          ? `/tv-shows?open=${candidate.id}`
          : `/books?open=${candidate.id}`,
    reason: buildRecommendationReason(candidate, signals),
  };
}

export async function generateSupabaseRecommendations() {
  const context = await prepareRecommendationContext();
  if (!context) {
    return { recommendations: [], tasteProfile: null, message: EMPTY_MESSAGE };
  }
  const { signals, excludedKeys } = context;

  const movieGenres = weightedGenreCounts(signals, 'movie').slice(0, 2);
  const showGenres = weightedGenreCounts(signals, 'tv_show').slice(0, 2);
  const bookGenres = weightedGenreCounts(signals, 'book').slice(0, 1);

  const [movies, shows, books] = await Promise.all([
    sampleMoviePool(movieGenres),
    sampleShowPool(showGenres),
    sampleBookPool(bookGenres),
  ]);

  // Enforce a mix: at least 4 movies, at least 4 TV shows, fill remainder with best overall
  const topMovies = topScored(movies, 'movie', signals, excludedKeys, 5);
  const topShows  = topScored(shows,  'tv_show', signals, excludedKeys, 5);
  const topBooks  = topScored(books,  'book', signals, excludedKeys, 2);
  const combined  = [...topMovies, ...topShows, ...topBooks]
    .sort((a, b) => b._score - a._score)
    .slice(0, 10);

  const recommendations = combined.map((candidate) => toRecommendation(candidate, signals));

  return {
    tasteProfile: buildTasteProfile(signals),
    recommendations,
    message: recommendations.length ? '' : 'No strong matches were found yet. Try rating a few more titles to sharpen your recommendations.',
  };
}

const TYPE_POOL_CONFIG = {
  movie: { sample: sampleMoviePool, genreSlice: 3 },
  tv_show: { sample: sampleShowPool, genreSlice: 3 },
  book: { sample: sampleBookPool, genreSlice: 2 },
};

// Deep, single-type recommendation list — used by the "Movies only" / "TV only" / "Books only"
// tabs so they surface a real top-12 for that type instead of duplicating the mixed Home list.
export async function generateSupabaseTypeRecommendations(mediaType) {
  const config = TYPE_POOL_CONFIG[mediaType];
  if (!config) {
    throw new Error(`Unsupported media type: ${mediaType}`);
  }

  const context = await prepareRecommendationContext();
  if (!context) {
    return { recommendations: [], tasteProfile: null, message: EMPTY_MESSAGE };
  }
  const { signals, excludedKeys } = context;

  const genres = weightedGenreCounts(signals, mediaType).slice(0, config.genreSlice);
  const pool = await config.sample(genres);
  const topItems = topScored(pool, mediaType, signals, excludedKeys, 12);
  const recommendations = topItems.map((candidate) => toRecommendation(candidate, signals));

  return {
    tasteProfile: buildTasteProfile(signals, mediaType),
    recommendations,
    message: recommendations.length ? '' : `No strong ${TYPE_LABELS[mediaType]} matches yet. Try rating a few more titles to sharpen your recommendations.`,
  };
}
