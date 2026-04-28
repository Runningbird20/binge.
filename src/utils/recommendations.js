import {
  fetchSupabaseRatings,
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

function buildTasteProfile(ratings) {
  const likedRatings = ratings.filter((rating) => getRatingStrength(rating) >= 4);
  const genreCounts = new Map();
  const typeCounts = new Map();

  likedRatings.forEach((rating) => {
    typeCounts.set(rating.media_type, (typeCounts.get(rating.media_type) || 0) + 1);
    splitGenres(rating.genre).forEach((genre) => {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    });
  });

  const favoriteTypes = [...typeCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([label]) => label === 'tv_show' ? 'TV shows' : label === 'movie' ? 'movies' : 'books');
  const favoriteGenres = [...genreCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([genre]) => genre);

  if (!likedRatings.length) {
    return 'You have started rating titles, but there is not enough strong preference data yet. Keep rating a few more things and your recommendations will sharpen up.';
  }

  if (!favoriteGenres.length) {
    return `You tend to rate ${favoriteTypes.join(' and ')} highly, so these picks lean into the parts of that library you seem to enjoy most.`;
  }

  return `You seem to gravitate toward ${favoriteGenres.join(', ')} with a strong pull toward ${favoriteTypes.join(' and ')}. These picks lean into the genres and tones you have rated most positively.`;
}

function scoreCandidate(candidate, ratings, ratedKeys) {
  const candidateKey = `${candidate.media_type}:${candidate.id}`;
  if (ratedKeys.has(candidateKey)) {
    return -Infinity;
  }

  const candidateGenres = splitGenres(candidate.genre);
  let score = 0;

  ratings.forEach((rating) => {
    const strength = getRatingStrength(rating);
    // Positive weight for liked, negative for disliked — disliked items actively penalize matches
    const weight = strength >= 4 ? 1.5 : strength >= 3 ? 0.5 : -1.0;

    const sharedGenres = candidateGenres.filter((genre) => splitGenres(rating.genre).includes(genre));
    score += sharedGenres.length * 2.5 * weight;

    // Boost same media type only for well-rated items
    if (candidate.media_type === rating.media_type && strength >= 4) {
      score += 1.0;
    }
  });

  // Slight recency bonus — prefer titles from last 20 years over very old ones
  if (candidate.year) {
    const age = THIS_YEAR - Number(candidate.year);
    score += Math.max(0, (20 - age)) / 20;
  }

  return score;
}

function buildRecommendationReason(candidate, ratings) {
  const candidateGenres = splitGenres(candidate.genre);

  // Find the best-rated item with genre overlap
  const matches = ratings
    .map((rating) => ({
      rating,
      overlap: candidateGenres.filter((genre) => splitGenres(rating.genre).includes(genre)).length,
      strength: getRatingStrength(rating),
    }))
    .filter((m) => m.overlap > 0 && m.strength >= 4)
    .sort((a, b) => b.overlap - a.overlap || b.strength - a.strength);

  const best = matches[0];

  if (best?.rating?.title) {
    const sharedGenre = candidateGenres.find((g) => splitGenres(best.rating.genre).includes(g));
    if (sharedGenre) {
      return `If you liked the ${sharedGenre.toLowerCase()} in ${best.rating.title}, this has the same energy.`;
    }
    return `Fans of ${best.rating.title} tend to love this one too.`;
  }

  if (candidateGenres.length) {
    const topLiked = ratings
      .filter((r) => getRatingStrength(r) >= 4)
      .sort((a, b) => getRatingStrength(b) - getRatingStrength(a))[0];
    if (topLiked?.title) {
      return `Based on how much you enjoyed ${topLiked.title}, this ${candidateGenres[0].toLowerCase()} pick should be right up your alley.`;
    }
    return `A strong pick from the ${candidateGenres.slice(0, 2).join(' / ').toLowerCase()} catalog based on your ratings.`;
  }

  return 'A strong match based on the patterns in your rating history.';
}

export async function generateSupabaseRecommendations() {
  const ratings = await fetchSupabaseRatings();
  if (!ratings.length) {
    return {
      recommendations: [],
      tasteProfile: null,
      message: 'Rate some movies, TV shows, or books first to unlock personalized recommendations.',
    };
  }

  const [movies, shows, books] = await Promise.all([
    fetchSupabaseMovieCatalogSegment({ offset: 0, limit: 100, includeCount: false, includeFacets: false }).then((result) => result.items || []),
    fetchSupabaseTvShowCatalogSegment({ offset: 0, limit: 100, includeCount: false, includeFacets: false }).then((result) => result.items || []),
    fetchSupabaseBooksPage({ page: 1, pageSize: 60 }).then((result) => result.items || []),
  ]);

  const ratedKeys = new Set(ratings.map((rating) => `${rating.media_type}:${rating.media_id}`));

  function topScored(items, mediaType, n) {
    return items
      .map((item) => ({ ...item, media_type: mediaType, _score: scoreCandidate({ ...item, media_type: mediaType }, ratings, ratedKeys) }))
      .filter((c) => Number.isFinite(c._score) && c._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, n);
  }

  // Enforce a mix: at least 4 movies, at least 4 TV shows, fill remainder with best overall
  const topMovies = topScored(movies, 'movie', 5);
  const topShows  = topScored(shows,  'tv_show', 5);
  const topBooks  = topScored(books,  'book', 2);
  const combined  = [...topMovies, ...topShows, ...topBooks]
    .sort((a, b) => b._score - a._score)
    .slice(0, 10);

  const recommendations = combined
    .map((candidate) => ({
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
      reason: buildRecommendationReason(candidate, ratings),
    }));

  return {
    tasteProfile: buildTasteProfile(ratings),
    recommendations,
    message: recommendations.length ? '' : 'No strong matches were found yet. Try rating a few more titles to sharpen your recommendations.',
  };
}
