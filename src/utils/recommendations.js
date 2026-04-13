import {
  fetchSupabaseRatings,
} from './supabaseData';
import {
  fetchSupabaseBooksPage,
  fetchSupabaseMovieCatalogSegment,
  fetchSupabaseTvShowCatalogSegment,
} from './supabaseMovieCatalog';

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
    const weight = strength >= 4 ? 1.2 : strength >= 3 ? 0.7 : 0.2;

    if (candidate.media_type === rating.media_type) {
      score += 1.5 * weight;
    }

    const sharedGenres = candidateGenres.filter((genre) => splitGenres(rating.genre).includes(genre));
    score += sharedGenres.length * 2.5 * weight;
  });

  score += candidate.year ? Math.max(0, Number(candidate.year) - 1990) / 50 : 0;
  return score;
}

function buildRecommendationReason(candidate, ratings) {
  const candidateGenres = splitGenres(candidate.genre);
  const closestMatch = ratings
    .map((rating) => ({
      rating,
      overlap: candidateGenres.filter((genre) => splitGenres(rating.genre).includes(genre)).length,
      strength: getRatingStrength(rating),
    }))
    .sort((left, right) => right.overlap - left.overlap || right.strength - left.strength)[0];

  if (closestMatch?.rating?.title && closestMatch.overlap > 0) {
    return `This lines up well with the ${candidateGenres.slice(0, 2).join(' and ').toLowerCase()} energy you liked in ${closestMatch.rating.title}.`;
  }

  if (candidateGenres.length) {
    return `This is a strong fit if you want more ${candidateGenres.slice(0, 2).join(' / ').toLowerCase()} from the binge catalog.`;
  }

  return 'This is a strong match based on the titles and formats you have rated most positively.';
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
    fetchSupabaseMovieCatalogSegment({ offset: 0, limit: 60, includeCount: false, includeFacets: false }).then((result) => result.items || []),
    fetchSupabaseTvShowCatalogSegment({ offset: 0, limit: 60, includeCount: false, includeFacets: false }).then((result) => result.items || []),
    fetchSupabaseBooksPage({ page: 1, pageSize: 60 }).then((result) => result.items || []),
  ]);

  const ratedKeys = new Set(ratings.map((rating) => `${rating.media_type}:${rating.media_id}`));
  const catalog = [
    ...movies.map((item) => ({ ...item, media_type: 'movie' })),
    ...shows.map((item) => ({ ...item, media_type: 'tv_show' })),
    ...books.map((item) => ({ ...item, media_type: 'book' })),
  ];

  const recommendations = catalog
    .map((candidate) => ({
      ...candidate,
      _score: scoreCandidate(candidate, ratings, ratedKeys),
    }))
    .filter((candidate) => Number.isFinite(candidate._score) && candidate._score > 0)
    .sort((left, right) => right._score - left._score)
    .slice(0, 5)
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
