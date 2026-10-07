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

// ISO date strings for query filters.
export function todayIso() {
  return startOfToday().toISOString().slice(0, 10);
}

export function comingSoonCutoffIso() {
  return new Date(startOfToday().getTime() + COMING_SOON_DAYS * DAY_MS).toISOString().slice(0, 10);
}

export function daysAgoIso(days) {
  return new Date(startOfToday().getTime() - days * DAY_MS).toISOString().slice(0, 10);
}
