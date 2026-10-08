// binge. Wrapped: turns a year of episodes, plays, ratings and finished
// titles into the recap's numbers. Minutes are estimates (45 per episode,
// 110 per movie) since embed servers don't report exact watch time.

import { computeStarRating } from '../components/RatingArtifact';

const EPISODE_MINUTES = 45;
const MOVIE_MINUTES = 110;

function inYear(date, year) {
  return date && new Date(date).getFullYear() === year;
}

function topCounts(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function bump(map, key, by = 1) {
  if (key) map.set(key, (map.get(key) || 0) + by);
}

// Turns a year of activity into the Wrapped story.
export function buildWrapped({ episodes, playing, ratings, watchlist }, year) {
  const eps = episodes.filter((row) => inYear(row.watched_at, year));
  const rated = ratings.filter((row) => inYear(row.created_at, year));
  const played = playing.filter((row) => inYear(row.updated_at, year));
  const finished = watchlist.filter((row) => (row.status === 'watched' || row.status === 'read') && inYear(row.updated_at || row.added_at, year));

  const titles = new Map(); // key -> record
  [...eps, ...rated, ...played, ...finished].forEach((row) => titles.set(`${row.media_type}:${row.media_id}`, row));
  const movieCount = [...titles.values()].filter((row) => row.media_type === 'movie').length;
  const minutes = eps.length * EPISODE_MINUTES + movieCount * MOVIE_MINUTES;

  const genres = new Map();
  const languages = new Map();
  titles.forEach((row) => {
    String(row.genre || '').split(',').map((g) => g.trim()).filter(Boolean).forEach((g) => bump(genres, g));
    if (row.original_language) bump(languages, row.original_language);
  });
  eps.forEach((row) => { if (row.original_language) bump(languages, row.original_language, 0.2); });

  const showEpisodes = new Map();
  eps.forEach((row) => bump(showEpisodes, row.media_id));
  const [topShowId, topShowEpisodes] = topCounts(showEpisodes, 1)[0] || [];
  const topShow = topShowId ? eps.find((row) => row.media_id === topShowId) : null;

  const months = new Map();
  [...eps.map((r) => r.watched_at), ...rated.map((r) => r.created_at), ...played.map((r) => r.updated_at)]
    .forEach((date) => bump(months, new Date(date).getMonth()));
  const [busiestMonth] = topCounts(months, 1)[0] || [];

  const days = new Map();
  eps.forEach((row) => bump(days, new Date(row.watched_at).toDateString()));
  const [bingeDay, bingeDayCount] = topCounts(days, 1)[0] || [];

  const favorites = rated
    .map((row) => ({ ...row, stars: computeStarRating(row.media_type, row) || 0 }))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 3);

  const topLanguage = topCounts(languages, 1)[0]?.[0];
  const topGenres = topCounts(genres, 3).map(([g]) => g);

  let persona = { name: 'The Explorer', line: 'You sampled a bit of everything.' };
  if (topLanguage === 'ko' && languages.get('ko') >= 2) persona = { name: 'The K-Drama Devotee', line: 'Seoul was basically your second home this year.' };
  else if (topLanguage === 'ja' && genres.has('Animation')) persona = { name: 'The Anime Loyalist', line: 'Subtitles on, opening songs never skipped.' };
  else if (bingeDayCount >= 6) persona = { name: 'The Marathoner', line: `${bingeDayCount} episodes in one day. Respect.` };
  else if (rated.length >= 15) persona = { name: 'The Critic', line: `${rated.length} ratings — your opinions shaped every pick.` };
  else if (genres.size >= 10) persona = { name: 'The Explorer', line: `${genres.size} different genres. Nothing is off limits.` };
  else if (topGenres[0]) persona = { name: `The ${topGenres[0]} Fan`, line: `You know exactly what you like: ${topGenres[0].toLowerCase()}.` };

  return {
    year,
    minutes,
    hours: Math.round(minutes / 60),
    episodeCount: eps.length,
    titleCount: titles.size,
    movieCount,
    ratingCount: rated.length,
    topShow: topShow ? { ...topShow, episodes: topShowEpisodes } : null,
    topGenres,
    topLanguage,
    busiestMonth,
    bingeDay: bingeDay ? { date: bingeDay, count: bingeDayCount } : null,
    favorites,
    persona,
  };
}
