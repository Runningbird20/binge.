// One rule for "can I watch this yet?" across every browse surface:
//   - released (on or before today)            -> show normally
//   - releasing within COMING_SOON_DAYS          -> show with a "Coming Soon" tag
//   - releasing later than that                  -> hide entirely
// Movies carry a full release_date; TV rows only have a year, so a TV
// title is treated as released once its year has started.
export const COMING_SOON_DAYS = 30;

const DAY_MS = 86400000;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function releaseDateOf(item) {
  return parseDate(item?.release_date || item?.releaseDate || item?.first_air_date);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function releaseStatus(item) {
  const today = startOfToday();
  const date = releaseDateOf(item);

  if (date) {
    if (date <= today) return 'released';
    const days = Math.ceil((date - today) / DAY_MS);
    return days <= COMING_SOON_DAYS ? 'coming_soon' : 'future';
  }

  const year = Number(item?.year);
  if (Number.isFinite(year) && year > 0) {
    return year > today.getFullYear() ? 'future' : 'released';
  }

  return 'released';
}

export function isBrowseable(item) {
  return releaseStatus(item) !== 'future';
}

export function isComingSoon(item) {
  return releaseStatus(item) === 'coming_soon';
}

export function formatReleaseDay(item) {
  const date = releaseDateOf(item);
  if (!date) return '';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ISO date strings for query filters: the viewer's own calendar date, like
// TMDB's release and air dates. Never toISOString(), which gives the UTC date:
// a day ahead in a US evening, and a day behind east of UTC all day.
export function localIsoDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Calendar days from today (setDate, so a clock change can't shift the day).
function dayFromToday(days) {
  const date = startOfToday();
  date.setDate(date.getDate() + days);
  return date;
}

export function todayIso() {
  return localIsoDate(startOfToday());
}

export function comingSoonCutoffIso() {
  return localIsoDate(dayFromToday(COMING_SOON_DAYS));
}

export function daysAgoIso(days) {
  return localIsoDate(dayFromToday(-days));
}

export function daysAheadIso(days) {
  return localIsoDate(dayFromToday(days));
}
