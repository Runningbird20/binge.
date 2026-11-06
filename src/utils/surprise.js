// "Surprise me with a movie / a series" on Home: one title of that type from the profile's own
// recommendations (Top Picks, then the "Because you watched" rows — already
// filtered for the profile's maturity level and the release window), leaning
// toward the strongest picks. Titles not out yet are skipped (they can't
// play), and so are the last few surprises, so pressing again finds
// something new. A profile with no history yet gets a trending title.
// Titles the profile has already watched (`exclude`, from
// utils/watchedTitles.js) are never picked.

const keyOf = (item) => `${item.media_type}:${item.media_id ?? item.id}`;
const watchable = (item) => item && (item.media_type === 'movie' || item.media_type === 'tv_show') && !item._comingSoon;

// The candidates, strongest first, each title once; only `mediaType`
// ('movie' / 'tv_show') when given, never one whose key is in `exclude`.
export function surprisePool(personal, fallback = [], { mediaType = '', exclude = null } = {}) {
  const seen = new Set(exclude || []);
  const pool = [];
  const add = (items, limit) => (items || [])
    .filter((item) => (!mediaType || item?.media_type === mediaType) && watchable(item) && !seen.has(keyOf(item)))
    .slice(0, limit)
    .forEach((item) => {
      if (seen.has(keyOf(item))) return;
      seen.add(keyOf(item));
      pool.push(item);
    });
  add(personal?.topPicks, 15);
  (personal?.becauseYouWatched || []).forEach((row) => add(row.items, 6));
  if (!pool.length) add(fallback, 20);
  return pool;
}

// One title from the pool (random, weighted toward the top), not one of
// `recent` unless nothing else is left. null when there's nothing to pick.
export function pickSurprise(pool, recent = [], random = Math.random) {
  const recentKeys = new Set(recent);
  const fresh = pool.filter((item) => !recentKeys.has(keyOf(item)));
  const choices = fresh.length ? fresh : pool;
  if (!choices.length) return null;
  const weights = choices.map((_, index) => 1 / (1 + index * 0.12));
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < choices.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return choices[index];
  }
  return choices[choices.length - 1];
}

export { keyOf as surpriseKey };
