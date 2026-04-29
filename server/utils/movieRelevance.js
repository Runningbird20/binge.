function getReleaseYear(movie) {
  const releaseDate = movie?.release_date || movie?.releaseDate || movie?.year;
  if (releaseDate == null) return 2000;

  const match = String(releaseDate).match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : 2000;
}

function calculateMovieRelevance(movie = {}) {
  const rtScore = movie.rotten_tomatoes_score ?? 50;
  const voteAverage = movie.vote_average ?? 0;
  const popularity = movie.popularity ?? 0;
  const releaseYear = getReleaseYear(movie);
  const currentYear = new Date().getFullYear();
  const recencyScore = Math.max(0, 100 - (currentYear - releaseYear) * 3);

  return (
    Number(rtScore) * 0.45 +
    Number(voteAverage) * 10 * 0.25 +
    Math.min(Number(popularity) || 0, 100) * 0.20 +
    recencyScore * 0.10
  );
}

module.exports = { calculateMovieRelevance };
