// Release calendar: everything coming to binge. (popular movies, new series
// and season premieres, within the release window), plus next episodes and
// announced seasons of the shows you follow (My List + Continue Watching) and
// upcoming movies on your list. Plus .ics export for phone calendars.
import { fetchSupabaseContinueWatching, fetchSupabaseWatchlist } from './supabaseData';
import { fetchDiscover, tmdbGet, tmdbIdFromItem } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';
// Local calendar dates, like TMDB's air dates (releaseWindow.js).
import { comingSoonCutoffIso, daysAgoIso, todayIso } from './releaseWindow';

// News, soaps and talk shows air every weekday; they'd fill every day.
const DAILY_TV = '10763|10766|10767';
// Popular shows on binge. whose season dates are looked up: one TMDB request each.
const BINGE_SHOWS = 20;

function titlePath(item) {
  return item.media_type === 'tv_show' ? `/tv-show/${item.media_id ?? item.id}` : `/movie/${item.media_id ?? item.id}`;
}

const posterOf = (path, fallback) => (path ? `https://image.tmdb.org/t/p/w342${path}` : fallback);
const episodeName = (episode) => (episode.name && !/^episode \d+$/i.test(episode.name) ? ` — “${episode.name}”` : '');

// A show's next episode and later seasons that already have a date, from its
// TMDB details. `row` is a library row (media_type, media_id, title, image_url).
function showEvents(row, data, today) {
  const events = [];
  const image = posterOf(data.poster_path, row.image_url);
  const title = row.title || data.name;
  const next = data.next_episode_to_air;
  if (next?.air_date && next.air_date >= today) {
    events.push({
      id: `ep:${row.media_id}:${next.season_number}:${next.episode_number}`,
      date: next.air_date,
      kind: next.episode_number === 1 ? 'season' : 'episode',
      title,
      detail: next.episode_number === 1
        ? `Season ${next.season_number} premiere${episodeName(next)}`
        : `S${next.season_number} · E${next.episode_number}${episodeName(next)}`,
      url: `${titlePath(row)}?play=1&season=${next.season_number}&episode=${next.episode_number}`,
      image,
    });
  }
  (data.seasons || [])
    .filter((season) => season.air_date && season.air_date > (next?.air_date || today) && season.season_number > (next?.season_number || 0))
    .forEach((season) => events.push({
      id: `season:${row.media_id}:${season.season_number}`,
      date: season.air_date,
      kind: 'season',
      title,
      detail: `Season ${season.season_number} premiere`,
      url: titlePath(row),
      image,
    }));
  return events;
}

// Your shows and movies: every episode, premiere and release we know a date for.
async function followedEvents(rows, today) {
  const events = [];
  const renewed = [];
  await Promise.all(rows.map(async (row) => {
    const tmdbId = tmdbIdFromItem(row);
    if (row.media_type === 'tv_show') {
      const data = await tmdbGet(`/tv/${tmdbId}`);
      if (!data) return;
      events.push(...showEvents(row, data, today));
      if (!data.next_episode_to_air && data.status === 'Returning Series' && data.in_production) {
        // The season after the last one that aired. Not number_of_seasons + 1:
        // TMDB often lists the announced season already, without dates.
        const lastAired = data.last_episode_to_air?.season_number;
        const confirmed = (lastAired > 0 ? lastAired : (data.number_of_seasons || 0)) + 1;
        renewed.push({ id: `renewed:${row.media_id}`, title: row.title || data.name, detail: `Season ${confirmed} confirmed — date not announced`, url: titlePath(row), image: posterOf(data.poster_path, row.image_url) });
      }
    } else {
      const data = await tmdbGet(`/movie/${tmdbId}`);
      const date = data?.release_date;
      if (date && date >= today) {
        events.push({
          id: `movie:${row.media_id}`,
          date,
          kind: 'movie',
          title: row.title || data.title,
          detail: 'Movie release',
          url: titlePath(row),
          image: posterOf(data.poster_path, row.image_url),
        });
      }
    }
  }));
  return { events: events.map((event) => ({ ...event, mine: true })), renewed };
}

const resolve = (list, mediaType, kidsSafe) => (list?.length ? resolveTmdbItems(list, mediaType, { kidsSafe }).catch(() => []) : []);

// Everyone's calendar: popular movies and new series coming to binge., and
// season premieres of popular shows on binge., from today to the end of the
// coming-soon window, at the profile's maturity level. Titles you follow are
// left to followedEvents. Any TMDB or catalog failure just leaves its part out.
async function bingeEvents({ kidsSafe, today, followed }) {
  const cutoff = comingSoonCutoffIso();
  const inWindow = (date) => Boolean(date) && date >= today && date <= cutoff;
  const discover = (mediaType, params) => fetchDiscover(mediaType, { sort_by: 'popularity.desc', ...params }).catch(() => null);
  const movieWindow = { 'primary_release_date.gte': today, 'primary_release_date.lte': cutoff };
  const [moviePage1, moviePage2, newSeries, airing] = await Promise.all([
    discover('movie', movieWindow),
    discover('movie', { ...movieWindow, page: 2 }),
    discover('tv_show', { 'first_air_date.gte': today, 'first_air_date.lte': cutoff, without_genres: DAILY_TV }),
    discover('tv_show', { 'air_date.gte': today, 'air_date.lte': cutoff, 'first_air_date.lte': daysAgoIso(1), without_genres: DAILY_TV }),
  ]);
  const [movies, series, shows] = await Promise.all([
    resolve([...(moviePage1 || []), ...(moviePage2 || [])], 'movie', kidsSafe),
    resolve(newSeries, 'tv_show', kidsSafe),
    resolve(airing, 'tv_show', kidsSafe),
  ]);
  const unfollowed = (mediaType) => (item) => !followed.has(`${mediaType}:${item.id}`);
  const popularity = (item) => item._tmdb?.popularity || 0;
  const events = [];

  movies.filter(unfollowed('movie')).forEach((item) => {
    const date = item._tmdb?.releaseDate || item.release_date;
    if (!inWindow(date)) return;
    events.push({ id: `movie:${item.id}`, date, kind: 'movie', title: item.title, detail: 'Movie release', url: `/movie/${item.id}`, image: posterOf(item._tmdb?.posterPath, item.poster_url), popularity: popularity(item) });
  });

  const premiering = new Set();
  series.filter(unfollowed('tv_show')).forEach((item) => {
    const date = item._tmdb?.releaseDate;
    if (!inWindow(date)) return;
    premiering.add(item.id);
    events.push({ id: `series:${item.id}`, date, kind: 'series', title: item.title, detail: 'Series premiere', url: `/tv-show/${item.id}`, image: posterOf(item._tmdb?.posterPath, item.poster_url), popularity: popularity(item) });
  });

  // Only premieres: every episode of every popular show would bury the rest.
  const returning = shows.filter((item) => unfollowed('tv_show')(item) && !premiering.has(item.id) && item._tmdb?.tmdbId).slice(0, BINGE_SHOWS);
  await Promise.all(returning.map(async (item) => {
    const data = await tmdbGet(`/tv/${item._tmdb.tmdbId}`).catch(() => null);
    if (!data) return;
    const row = { media_type: 'tv_show', media_id: item.id, title: item.title, image_url: item.poster_url };
    showEvents(row, data, today)
      .filter((event) => event.kind === 'season' && inWindow(event.date))
      .forEach((event) => events.push({ ...event, popularity: popularity(item) }));
  }));

  return events;
}

// { events: [{ id, date, kind, title, detail, url, image, mine?, popularity? }], renewed: [...] }
// kind: 'episode' | 'season' | 'movie' | 'series'. `mine` marks titles you
// follow; within a day they come first, then the most popular.
export async function loadReleaseCalendar({ kidsSafe = false } = {}) {
  const [watchlist, playing] = await Promise.all([
    fetchSupabaseWatchlist().catch(() => []),
    fetchSupabaseContinueWatching().catch(() => []),
  ]);
  const today = todayIso();
  const followed = new Map();
  [...playing, ...watchlist].forEach((row) => {
    if (row.media_type !== 'tv_show' && row.media_type !== 'movie') return;
    if (row.media_type === 'movie' && row.status === 'watched') return;
    followed.set(`${row.media_type}:${row.media_id}`, row);
  });

  const rows = [...followed.values()].filter((row) => tmdbIdFromItem(row)).slice(0, 80);
  const [mine, everyone] = await Promise.all([
    followedEvents(rows, today),
    bingeEvents({ kidsSafe, today, followed }),
  ]);

  const seen = new Set();
  const events = [...mine.events, ...everyone].filter((event) => !seen.has(event.id) && seen.add(event.id));
  events.sort((a, b) => a.date.localeCompare(b.date)
    || Number(Boolean(b.mine)) - Number(Boolean(a.mine))
    || (b.popularity || 0) - (a.popularity || 0)
    || a.title.localeCompare(b.title));

  return { events, renewed: mine.renewed };
}

// ── Month view ─────────────────────────────────────────────────────────
// Months are 'YYYY-MM' and days 'YYYY-MM-DD', local calendar dates like the
// events' own (never toISOString(), which is the UTC date).

const pad = (value) => String(value).padStart(2, '0');

export const monthOf = (iso) => iso.slice(0, 7);

function addMonth(month, step) {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(year, index - 1 + step, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

// This month through the month of the last release, empty months included,
// so the arrows step one month at a time.
export function calendarMonths(events, today = todayIso()) {
  const first = monthOf(today);
  const last = events.reduce((latest, event) => (monthOf(event.date) > latest ? monthOf(event.date) : latest), first);
  const months = [];
  for (let month = first; month <= last; month = addMonth(month, 1)) months.push(month);
  return months;
}

// The month as weeks of 7 days starting on `firstDay` (0 = Sunday), with
// null for the days before the 1st and after the last.
export function monthWeeks(month, firstDay = 0) {
  const [year, index] = month.split('-').map(Number);
  const length = new Date(year, index, 0).getDate();
  const lead = (new Date(year, index - 1, 1).getDay() - firstDay + 7) % 7;
  const days = [
    ...Array(lead).fill(null),
    ...Array.from({ length }, (_, day) => `${month}-${pad(day + 1)}`),
  ];
  while (days.length % 7) days.push(null);
  const weeks = [];
  for (let start = 0; start < days.length; start += 7) weeks.push(days.slice(start, start + 7));
  return weeks;
}

// The locale's first day of the week (0 = Sunday, 1 = Monday), Sunday where
// the browser can't say. Intl numbers the days 1 = Monday … 7 = Sunday.
export function firstDayOfWeek(locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US') {
  try {
    const tag = new Intl.Locale(locale);
    const info = tag.getWeekInfo?.() || tag.weekInfo;
    if (info?.firstDay) return info.firstDay % 7;
  } catch { /* unknown locale */ }
  return 0;
}

// Events by day, in the order they came (already sorted by loadReleaseCalendar).
export function eventsByDate(events) {
  const map = new Map();
  events.forEach((event) => map.set(event.date, [...(map.get(event.date) || []), event]));
  return map;
}

// ── .ics export ────────────────────────────────────────────────────────

function icsText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

function icsDate(iso) {
  return iso.replace(/-/g, '');
}

function nextDay(iso) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function buildIcs(events, origin = window.location.origin) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//binge.//Release calendar//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:binge. releases',
  ];
  events.forEach((event) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(event.id)}@binge`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(event.date)}`,
      `DTEND;VALUE=DATE:${icsDate(nextDay(event.date))}`,
      `SUMMARY:${icsText(`${event.title}: ${event.detail}`)}`,
      `DESCRIPTION:${icsText(`Watch on binge.: ${origin}${event.url}`)}`,
      `URL:${origin}${event.url}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

// Phones: hand the file to the share sheet (opens straight in Calendar);
// desktop: download it.
export async function exportToCalendar(events, filename = 'binge-releases.ics') {
  const blob = new Blob([buildIcs(events)], { type: 'text/calendar' });
  const file = new File([blob], filename, { type: 'text/calendar' });
  if (navigator.canShare?.({ files: [file] }) && window.matchMedia?.('(pointer: coarse)').matches) {
    try {
      await navigator.share({ files: [file], title: 'binge. releases' });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
