// Release calendar: next episodes and announced seasons of the shows you
// follow (My List + Continue Watching), upcoming movies on your list, and
// what's coming soon to binge. Plus .ics export for phone calendars.
import { fetchSupabaseContinueWatching, fetchSupabaseWatchlist } from './supabaseData';
import { fetchDiscover, tmdbGet, tmdbIdFromItem } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';
import { comingSoonCutoffIso } from './releaseWindow';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function titlePath(item) {
  return item.media_type === 'tv_show' ? `/tv-show/${item.media_id ?? item.id}` : `/movie/${item.media_id ?? item.id}`;
}

// { events: [{ id, date, kind, title, detail, url, image }], renewed: [...], comingSoon: [items] }
export async function loadReleaseCalendar() {
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
  const events = [];
  const renewed = [];

  await Promise.all(rows.map(async (row) => {
    const tmdbId = tmdbIdFromItem(row);
    if (row.media_type === 'tv_show') {
      const data = await tmdbGet(`/tv/${tmdbId}`);
      if (!data) return;
      const image = data.poster_path ? `https://image.tmdb.org/t/p/w342${data.poster_path}` : row.image_url;
      const next = data.next_episode_to_air;
      if (next?.air_date && next.air_date >= today) {
        events.push({
          id: `ep:${row.media_id}:${next.season_number}:${next.episode_number}`,
          date: next.air_date,
          kind: next.episode_number === 1 ? 'season' : 'episode',
          title: row.title || data.name,
          detail: next.episode_number === 1
            ? `Season ${next.season_number} premiere${next.name && !/^episode \d+$/i.test(next.name) ? ` — “${next.name}”` : ''}`
            : `S${next.season_number} · E${next.episode_number}${next.name && !/^episode \d+$/i.test(next.name) ? ` — “${next.name}”` : ''}`,
          url: `${titlePath(row)}?play=1&season=${next.season_number}&episode=${next.episode_number}`,
          image,
        });
      }
      // Later seasons that already have a date.
      (data.seasons || [])
        .filter((season) => season.air_date && season.air_date > (next?.air_date || today) && season.season_number > (next?.season_number || 0))
        .forEach((season) => events.push({
          id: `season:${row.media_id}:${season.season_number}`,
          date: season.air_date,
          kind: 'season',
          title: row.title || data.name,
          detail: `Season ${season.season_number} premiere`,
          url: titlePath(row),
          image,
        }));
      if (!next && data.status === 'Returning Series' && data.in_production) {
        renewed.push({ id: `renewed:${row.media_id}`, title: row.title || data.name, detail: `Season ${(data.number_of_seasons || 0) + 1} confirmed — date not announced`, url: titlePath(row), image });
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
          image: data.poster_path ? `https://image.tmdb.org/t/p/w342${data.poster_path}` : row.image_url,
        });
      }
    }
  }));

  events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  const upcoming = await fetchDiscover('movie', {
    'primary_release_date.gte': plusDays(1),
    'primary_release_date.lte': comingSoonCutoffIso(),
    sort_by: 'popularity.desc',
  }).catch(() => null);
  const comingSoon = upcoming ? (await resolveTmdbItems(upcoming, 'movie').catch(() => []))
    .filter((item) => !followed.has(`movie:${item.id}`))
    .slice(0, 12) : [];

  return { events, renewed, comingSoon };
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
