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

// ── Year-round ticket book ─────────────────────────────────────────────
// Monthly stubs, the countries you "visited", and achievement tickets,
// from the same activity as Wrapped, so it can be opened any month.

export function buildTicketBook({ episodes, playing, ratings, watchlist }, year, now = new Date()) {
  const eps = episodes.filter((row) => inYear(row.watched_at, year));
  const rated = ratings.filter((row) => inYear(row.created_at, year));
  const played = playing.filter((row) => inYear(row.updated_at, year));
  const finished = watchlist.filter((row) => (row.status === 'watched' || row.status === 'read') && inYear(row.updated_at || row.added_at, year));

  const months = Array.from({ length: 12 }, (_, month) => ({
    month,
    future: year === now.getFullYear() && month > now.getMonth(),
    episodes: 0,
    titles: new Map(),
  }));
  const touch = (row, date) => {
    const at = new Date(date);
    if (Number.isNaN(at.getTime())) return;
    const entry = months[at.getMonth()];
    const key = `${row.media_type}:${row.media_id}`;
    const current = entry.titles.get(key) || { row, count: 0 };
    current.count += 1;
    entry.titles.set(key, current);
  };
  eps.forEach((row) => { months[new Date(row.watched_at).getMonth()].episodes += 1; touch(row, row.watched_at); });
  played.forEach((row) => touch(row, row.updated_at));
  rated.forEach((row) => touch(row, row.created_at));

  const monthly = months.map((entry) => {
    const movies = [...entry.titles.values()].filter(({ row }) => row.media_type === 'movie').length;
    const top = [...entry.titles.values()].sort((a, b) => b.count - a.count)[0]?.row || null;
    return {
      month: entry.month,
      future: entry.future,
      episodes: entry.episodes,
      titles: entry.titles.size,
      hours: Math.round((entry.episodes * EPISODE_MINUTES + movies * MOVIE_MINUTES) / 60),
      top,
    };
  });

  const allTitles = new Map();
  [...eps, ...rated, ...played, ...finished].forEach((row) => allTitles.set(`${row.media_type}:${row.media_id}`, row));
  const genres = new Set();
  allTitles.forEach((row) => String(row.genre || '').split(',').map((g) => g.trim()).filter(Boolean).forEach((g) => genres.add(g)));
  const days = new Map();
  eps.forEach((row) => bump(days, new Date(row.watched_at).toDateString()));
  const bestDay = Math.max(0, ...days.values());
  const lateNights = eps.filter((row) => { const h = new Date(row.watched_at).getHours(); return h >= 0 && h < 4; }).length;
  const finishedShows = finished.filter((row) => row.media_type === 'tv_show').length;
  const books = finished.filter((row) => row.media_type === 'book').length;

  const achievement = (key, title, line, progress, goal) => ({ key, title, line, progress: Math.min(progress, goal), goal, earned: progress >= goal });
  const achievements = [
    achievement('eps100', 'Century', '100 episodes this year', eps.length, 100),
    achievement('marathon', 'Marathoner', '6 episodes in one day', bestDay, 6),
    achievement('critic', 'Critic', '25 ratings this year', rated.length, 25),
    achievement('genres', 'Genre hopper', '10 different genres', genres.size, 10),
    achievement('night', 'Night owl', '10 episodes after midnight', lateNights, 10),
    achievement('finisher', 'Completionist', 'Finish 3 series', finishedShows, 3),
    achievement('reader', 'Bookworm', 'Finish 5 books', books, 5),
    achievement('films', 'Movie buff', '25 movies', [...allTitles.values()].filter((row) => row.media_type === 'movie').length, 25),
  ];

  return {
    year,
    monthly,
    achievements,
    // Titles to look up countries for (passport), most-watched first.
    titles: [...allTitles.values()].filter((row) => row.media_type === 'movie' || row.media_type === 'tv_show'),
  };
}

// Countries from TMDB details (production_countries / origin_country),
// counted once per title.
export function countPassport(detailsList) {
  const countries = new Map();
  detailsList.forEach((details) => {
    if (!details) return;
    const codes = new Set([
      ...(details.production_countries || []).map((c) => c.iso_3166_1),
      ...(details.origin_country || []),
    ].filter(Boolean));
    codes.forEach((code) => countries.set(code, (countries.get(code) || 0) + 1));
  });
  return [...countries.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count }));
}
