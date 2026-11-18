import {
  buildIcs, calendarMonths, eventsByDate, exportToCalendar, firstDayOfWeek, loadReleaseCalendar, monthWeeks,
} from './releaseCalendar';
import { fetchSupabaseContinueWatching, fetchSupabaseWatchlist } from './supabaseData';
import { fetchDiscover, tmdbGet } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';
import { comingSoonCutoffIso } from './releaseWindow';

jest.mock('./supabaseData', () => ({ fetchSupabaseContinueWatching: jest.fn(), fetchSupabaseWatchlist: jest.fn() }));
jest.mock('./tmdb', () => ({ ...jest.requireActual('./tmdb'), tmdbGet: jest.fn(), fetchDiscover: jest.fn() }));
jest.mock('./catalogLookup', () => ({ resolveTmdbItems: jest.fn() }));

// Local noon: the same calendar day in local time and UTC for any zone
// within 11 hours of UTC.
const NOW = new Date(2026, 5, 10, 12, 0, 0); // June 10, 2026

const show = (mediaId, tmdbId, extra = {}) => ({ media_type: 'tv_show', media_id: mediaId, source_key: `tmdb:tv:${tmdbId}`, title: `Show ${mediaId}`, ...extra });
const movie = (mediaId, tmdbId, extra = {}) => ({ media_type: 'movie', media_id: mediaId, source_key: `tmdb:movie:${tmdbId}`, title: `Movie ${mediaId}`, ...extra });
const episode = (season, episodeNumber, airDate, name = '') => ({ season_number: season, episode_number: episodeNumber, air_date: airDate, name });

let tmdb = {};

function follow({ watchlist = [], continueWatching = [] } = {}) {
  fetchSupabaseWatchlist.mockResolvedValue(watchlist);
  fetchSupabaseContinueWatching.mockResolvedValue(continueWatching);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  tmdb = {};
  tmdbGet.mockImplementation(async (path) => tmdb[path] ?? null);
  fetchDiscover.mockResolvedValue([]);
  resolveTmdbItems.mockResolvedValue([]);
  follow();
});

afterEach(() => jest.useRealTimers());

describe('loadReleaseCalendar: your shows', () => {
  test('a followed show’s next episode is on the calendar, linked to play that episode', async () => {
    follow({ continueWatching: [show(10, 100, { title: 'Severance', current_season: 2, current_episode: 3, image_url: '/row.jpg' })] });
    tmdb['/tv/100'] = { name: 'Severance (TMDB)', poster_path: '/sev.jpg', next_episode_to_air: episode(2, 5, '2026-06-12', 'Cold Harbor') };

    const { events, renewed } = await loadReleaseCalendar();

    expect(events).toEqual([{
      id: 'ep:10:2:5',
      date: '2026-06-12',
      kind: 'episode',
      title: 'Severance',
      detail: 'S2 · E5 — “Cold Harbor”',
      url: '/tv-show/10?play=1&season=2&episode=5',
      image: 'https://image.tmdb.org/t/p/w342/sev.jpg',
      mine: true,
    }]);
    expect(renewed).toEqual([]);
  });

  test('a next episode that opens a season is a season premiere; placeholder names aren’t quoted', async () => {
    follow({ watchlist: [show(1, 100), show(2, 200)] });
    tmdb['/tv/100'] = { next_episode_to_air: episode(3, 1, '2026-06-20', 'Episode 1') };
    tmdb['/tv/200'] = { next_episode_to_air: episode(2, 7, '2026-06-15', 'Episode 7') };

    const { events } = await loadReleaseCalendar();

    expect(events.map((event) => [event.title, event.kind, event.detail])).toEqual([
      ['Show 2', 'episode', 'S2 · E7'],
      ['Show 1', 'season', 'Season 3 premiere'],
    ]);
    expect(events[1].url).toBe('/tv-show/1?play=1&season=3&episode=1');
  });

  test('a named season premiere keeps its episode title', async () => {
    follow({ watchlist: [show(1, 100)] });
    tmdb['/tv/100'] = { next_episode_to_air: episode(3, 1, '2026-06-20', 'Homecoming') };

    const { events } = await loadReleaseCalendar();
    expect(events[0].detail).toBe('Season 3 premiere — “Homecoming”');
  });

  test('an episode airing today is listed; one that already aired is not', async () => {
    follow({ watchlist: [show(1, 100), show(2, 200)] });
    tmdb['/tv/100'] = { next_episode_to_air: episode(1, 4, '2026-06-10') };
    tmdb['/tv/200'] = { next_episode_to_air: episode(1, 4, '2026-06-09') };

    const { events } = await loadReleaseCalendar();
    expect(events.map((event) => event.id)).toEqual(['ep:1:1:4']);
  });

  test('tonight’s episode is still on the calendar late in the evening', async () => {
    // "Today" is the local date. It was the UTC date, already tomorrow in a US
    // evening, so tonight's episodes vanished from about 7pm Eastern.
    jest.setSystemTime(new Date(2026, 5, 10, 23, 30));
    follow({ watchlist: [show(1, 100)] });
    tmdb['/tv/100'] = { next_episode_to_air: episode(1, 4, '2026-06-10') };

    const { events } = await loadReleaseCalendar();
    expect(events.map((event) => event.id)).toEqual(['ep:1:1:4']);
  });

  test('later seasons that already have a date get their own premiere, without repeating the next episode’s season', async () => {
    follow({ watchlist: [show(10, 100, { title: 'The Bear' })] });
    tmdb['/tv/100'] = {
      poster_path: '/bear.jpg',
      next_episode_to_air: episode(3, 1, '2026-06-20'),
      seasons: [
        { season_number: 1, air_date: '2022-06-23' },
        { season_number: 2, air_date: '2023-06-22' },
        { season_number: 3, air_date: '2026-06-20' },
        { season_number: 4, air_date: '2027-01-15' },
        { season_number: 5, air_date: null },
      ],
    };

    const { events } = await loadReleaseCalendar();

    expect(events.map((event) => [event.id, event.date, event.kind, event.detail])).toEqual([
      ['ep:10:3:1', '2026-06-20', 'season', 'Season 3 premiere'],
      ['season:10:4', '2027-01-15', 'season', 'Season 4 premiere'],
    ]);
    expect(events[1]).toMatchObject({ title: 'The Bear', url: '/tv-show/10', image: 'https://image.tmdb.org/t/p/w342/bear.jpg' });
  });

  test('with no next episode, only dated future seasons are listed, not specials', async () => {
    follow({ watchlist: [show(10, 100)] });
    tmdb['/tv/100'] = {
      status: 'Returning Series',
      seasons: [
        { season_number: 0, air_date: '2026-12-24' },
        { season_number: 2, air_date: '2025-03-01' },
        { season_number: 3, air_date: '2026-09-01' },
      ],
    };

    const { events } = await loadReleaseCalendar();
    expect(events.map((event) => event.id)).toEqual(['season:10:3']);
  });

  test('a renewed show without a date says which season is confirmed', async () => {
    follow({ watchlist: [show(1, 100, { title: 'Renewed', image_url: '/r.jpg' }), show(2, 200), show(3, 300)] });
    tmdb['/tv/100'] = { status: 'Returning Series', in_production: true, number_of_seasons: 4 };
    tmdb['/tv/200'] = { status: 'Ended', in_production: false, number_of_seasons: 6 };
    tmdb['/tv/300'] = { status: 'Returning Series', in_production: true, number_of_seasons: 2, next_episode_to_air: episode(2, 3, '2026-06-11') };

    const { renewed, events } = await loadReleaseCalendar();

    expect(renewed).toEqual([{ id: 'renewed:1', title: 'Renewed', detail: 'Season 5 confirmed — date not announced', url: '/tv-show/1', image: '/r.jpg' }]);
    expect(events.map((event) => event.id)).toEqual(['ep:3:2:3']);
  });

  test('the confirmed season is the one after the last that aired, even when TMDB already lists it undated', async () => {
    // Severance on TMDB (2026-11): two seasons aired, Season 3 listed without dates.
    follow({ watchlist: [show(1, 100, { title: 'Severance' })] });
    tmdb['/tv/100'] = {
      status: 'Returning Series', in_production: true, number_of_seasons: 3,
      last_episode_to_air: episode(2, 10, '2025-03-21'),
      seasons: [{ season_number: 1, air_date: '2022-02-18' }, { season_number: 2, air_date: '2025-01-17' }, { season_number: 3, air_date: null }],
    };

    const { renewed } = await loadReleaseCalendar();

    expect(renewed.map((entry) => entry.detail)).toEqual(['Season 3 confirmed — date not announced']);
  });

  test('a show marked Watched still gets its new season', async () => {
    follow({ watchlist: [show(1, 100, { status: 'watched' })] });
    tmdb['/tv/100'] = { next_episode_to_air: episode(2, 1, '2026-07-01') };

    const { events } = await loadReleaseCalendar();
    expect(events.map((event) => event.id)).toEqual(['ep:1:2:1']);
  });

  test('a show in both Continue Watching and My List shows up once', async () => {
    follow({
      continueWatching: [show(1, 100, { current_season: 1, current_episode: 3 })],
      watchlist: [show(1, 100, { status: 'watching' })],
    });
    tmdb['/tv/100'] = { next_episode_to_air: episode(1, 4, '2026-06-12') };

    const { events } = await loadReleaseCalendar();
    expect(events).toHaveLength(1);
    expect(tmdbGet).toHaveBeenCalledTimes(1);
  });
});

describe('loadReleaseCalendar: your movies', () => {
  test('upcoming movies on My List are listed; released or already watched ones aren’t', async () => {
    follow({
      watchlist: [
        movie(20, 200, { title: 'Dune: Part Three', image_url: '/dune-row.jpg' }),
        movie(21, 210),
        movie(22, 220, { status: 'watched' }),
      ],
    });
    tmdb['/movie/200'] = { release_date: '2026-12-18' };
    tmdb['/movie/210'] = { release_date: '2026-05-01' };
    tmdb['/movie/220'] = { release_date: '2026-07-01' };

    const { events } = await loadReleaseCalendar();

    expect(events).toEqual([{
      id: 'movie:20',
      date: '2026-12-18',
      kind: 'movie',
      title: 'Dune: Part Three',
      detail: 'Movie release',
      url: '/movie/20',
      image: '/dune-row.jpg',
      mine: true,
    }]);
    expect(tmdbGet).not.toHaveBeenCalledWith('/movie/220');
  });

  test('a movie releasing today is listed', async () => {
    follow({ watchlist: [movie(20, 200)] });
    tmdb['/movie/200'] = { release_date: '2026-06-10', poster_path: '/m.jpg' };

    const { events } = await loadReleaseCalendar();
    expect(events).toEqual([expect.objectContaining({ id: 'movie:20', date: '2026-06-10', image: 'https://image.tmdb.org/t/p/w342/m.jpg' })]);
  });
});

describe('loadReleaseCalendar: putting it together', () => {
  test('events run in date order, then by title', async () => {
    follow({ watchlist: [show(1, 100, { title: 'Zorro' }), show(2, 200, { title: 'Andor' }), movie(3, 300, { title: 'Middle' })] });
    tmdb['/tv/100'] = { next_episode_to_air: episode(1, 2, '2026-06-12') };
    tmdb['/tv/200'] = { next_episode_to_air: episode(1, 2, '2026-06-12') };
    tmdb['/movie/300'] = { release_date: '2026-06-11' };

    const { events } = await loadReleaseCalendar();
    expect(events.map((event) => event.title)).toEqual(['Middle', 'Andor', 'Zorro']);
  });

  test('titles without a TMDB id and failed TMDB lookups are skipped, the rest still load', async () => {
    follow({ watchlist: [{ media_type: 'tv_show', media_id: 1, title: 'No id' }, show(2, 200), show(3, 300), { media_type: 'book', media_id: 4, source_key: 'tmdb:tv:400' }] });
    tmdb['/tv/300'] = { next_episode_to_air: episode(1, 2, '2026-06-12') };

    const { events } = await loadReleaseCalendar();
    expect(events.map((event) => event.id)).toEqual(['ep:3:1:2']);
    expect(tmdbGet.mock.calls.map(([path]) => path).sort()).toEqual(['/tv/200', '/tv/300']);
  });

  test('the calendar still loads when My List or Continue Watching can’t be fetched', async () => {
    fetchSupabaseWatchlist.mockRejectedValue(new Error('offline'));
    fetchSupabaseContinueWatching.mockResolvedValue([show(1, 100)]);
    tmdb['/tv/100'] = { next_episode_to_air: episode(1, 2, '2026-06-12') };

    await expect(loadReleaseCalendar()).resolves.toMatchObject({ events: [expect.objectContaining({ id: 'ep:1:1:2' })] });

    fetchSupabaseWatchlist.mockResolvedValue([show(1, 100)]);
    fetchSupabaseContinueWatching.mockRejectedValue(new Error('offline'));
    await expect(loadReleaseCalendar()).resolves.toMatchObject({ events: [expect.objectContaining({ id: 'ep:1:1:2' })] });
  });
});

describe('loadReleaseCalendar: everything coming to binge.', () => {
  const CUTOFF = '2026-07-10'; // 30 days after June 10
  const result = (tmdbId, releaseDate, extra = {}) => ({ tmdbId, releaseDate, posterPath: `/p${tmdbId}.jpg`, popularity: 10, ...extra });
  const eventsOf = async (options) => (await loadReleaseCalendar(options)).events;

  // Which TMDB discover list a call is, by its parameters.
  function discover(lists) {
    fetchDiscover.mockImplementation(async (mediaType, params) => {
      if (mediaType === 'movie') return (params.page === 2 ? lists.moviePage2 : lists.movies) || [];
      return (params['first_air_date.gte'] ? lists.newSeries : lists.airing) || [];
    });
  }

  beforeEach(() => {
    // Every TMDB title is on binge., as catalog id tmdbId + 1000.
    resolveTmdbItems.mockImplementation(async (list) => list.map((item) => ({ id: item.tmdbId + 1000, title: `Title ${item.tmdbId}`, poster_url: '/catalog.jpg', _tmdb: item })));
  });

  test('popular movies from today to the end of the coming-soon window, two pages, at the profile’s maturity level', async () => {
    discover({ movies: [result(1, '2026-06-10'), result(2, '2026-06-20', { posterPath: null })], moviePage2: [result(3, CUTOFF)] });

    const events = await eventsOf({ kidsSafe: 'kids' });

    const window = { sort_by: 'popularity.desc', 'primary_release_date.gte': '2026-06-10', 'primary_release_date.lte': comingSoonCutoffIso() };
    expect(fetchDiscover).toHaveBeenCalledWith('movie', window);
    expect(fetchDiscover).toHaveBeenCalledWith('movie', { ...window, page: 2 });
    expect(resolveTmdbItems).toHaveBeenCalledWith([result(1, '2026-06-10'), result(2, '2026-06-20', { posterPath: null }), result(3, CUTOFF)], 'movie', { kidsSafe: 'kids' });
    expect(events).toEqual([
      { id: 'movie:1001', date: '2026-06-10', kind: 'movie', title: 'Title 1', detail: 'Movie release', url: '/movie/1001', image: 'https://image.tmdb.org/t/p/w342/p1.jpg', popularity: 10 },
      { id: 'movie:1002', date: '2026-06-20', kind: 'movie', title: 'Title 2', detail: 'Movie release', url: '/movie/1002', image: '/catalog.jpg', popularity: 10 },
      { id: 'movie:1003', date: CUTOFF, kind: 'movie', title: 'Title 3', detail: 'Movie release', url: '/movie/1003', image: 'https://image.tmdb.org/t/p/w342/p3.jpg', popularity: 10 },
    ]);
  });

  test('new series premiering in the window, leaving out news, soaps and talk shows', async () => {
    discover({ newSeries: [result(7, '2026-06-15')] });

    const events = await eventsOf();

    expect(fetchDiscover).toHaveBeenCalledWith('tv_show', {
      sort_by: 'popularity.desc', 'first_air_date.gte': '2026-06-10', 'first_air_date.lte': comingSoonCutoffIso(), without_genres: '10763|10766|10767',
    });
    expect(events).toEqual([{ id: 'series:1007', date: '2026-06-15', kind: 'series', title: 'Title 7', detail: 'Series premiere', url: '/tv-show/1007', image: 'https://image.tmdb.org/t/p/w342/p7.jpg', popularity: 10 }]);
  });

  test('popular returning shows add their season premieres, not their weekly episodes', async () => {
    discover({ airing: [result(8, '2019-01-01'), result(9, '2020-01-01')] });
    tmdb['/tv/8'] = { poster_path: '/s8.jpg', next_episode_to_air: episode(3, 1, '2026-06-18', 'Pilot'), seasons: [{ season_number: 4, air_date: '2026-12-01' }] };
    tmdb['/tv/9'] = { next_episode_to_air: episode(2, 6, '2026-06-12') };

    const events = await eventsOf();

    expect(fetchDiscover).toHaveBeenCalledWith('tv_show', {
      sort_by: 'popularity.desc', 'air_date.gte': '2026-06-10', 'air_date.lte': comingSoonCutoffIso(), 'first_air_date.lte': '2026-06-09', without_genres: '10763|10766|10767',
    });
    // Season 4 is past the window.
    expect(events).toEqual([{
      id: 'ep:1008:3:1', date: '2026-06-18', kind: 'season', title: 'Title 8', detail: 'Season 3 premiere — “Pilot”', url: '/tv-show/1008?play=1&season=3&episode=1', image: 'https://image.tmdb.org/t/p/w342/s8.jpg', popularity: 10,
    }]);
  });

  test('at most 20 returning shows are looked up, and a show premiering as a new series isn’t looked up again', async () => {
    discover({ newSeries: [result(1, '2026-06-15')], airing: Array.from({ length: 30 }, (_, i) => result(i + 1, '2020-01-01')) });

    await eventsOf();

    const looked = tmdbGet.mock.calls.map(([path]) => path);
    expect(looked).toHaveLength(20);
    expect(looked).not.toContain('/tv/1');
    expect(looked).toContain('/tv/21');
  });

  test('titles you follow come from your own list, first in their day, then the most popular', async () => {
    follow({ watchlist: [movie(1005, 5, { title: 'Yours' })] });
    tmdb['/movie/5'] = { release_date: '2026-06-20' };
    discover({ movies: [result(5, '2026-06-20'), result(6, '2026-06-20', { popularity: 5 }), result(4, '2026-06-20', { popularity: 50 })] });

    const events = await eventsOf();

    expect(events.map((event) => [event.id, Boolean(event.mine)])).toEqual([['movie:1005', true], ['movie:1004', false], ['movie:1006', false]]);
  });

  test('a release date outside the window (the catalog’s, when TMDB has none) leaves a title out', async () => {
    discover({ movies: [result(1, '2026-06-09'), result(2, '2026-07-11'), result(3, null)] });
    resolveTmdbItems.mockImplementation(async (list) => list.map((item) => ({ id: item.tmdbId, title: 'T', release_date: item.tmdbId === 3 ? '2026-06-30' : null, _tmdb: item })));

    expect((await eventsOf()).map((event) => event.id)).toEqual(['movie:3']);
  });

  test('with no maturity level given, nothing is restricted', async () => {
    discover({ movies: [result(1, '2026-06-20')] });
    await eventsOf();
    expect(resolveTmdbItems).toHaveBeenCalledWith([result(1, '2026-06-20')], 'movie', { kidsSafe: false });
  });

  test('your calendar still loads when TMDB or the catalog can’t be reached', async () => {
    follow({ watchlist: [show(1, 100)] });
    tmdb['/tv/100'] = { next_episode_to_air: episode(1, 2, '2026-06-12') };

    fetchDiscover.mockRejectedValue(new Error('TMDB down'));
    expect((await eventsOf()).map((event) => event.id)).toEqual(['ep:1:1:2']);

    discover({ movies: [result(1, '2026-06-20')], airing: [result(2, '2020-01-01')] });
    resolveTmdbItems.mockRejectedValue(new Error('catalog down'));
    expect((await eventsOf()).map((event) => event.id)).toEqual(['ep:1:1:2']);
  });
});

describe('month view', () => {
  const on = (date, id = date) => ({ id, date });

  test('months run from this one to the month of the last release, empty months included', () => {
    expect(calendarMonths([on('2026-06-12'), on('2026-09-01'), on('2026-07-04')], '2026-06-10')).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(calendarMonths([on('2027-02-01')], '2026-11-18')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(calendarMonths([], '2026-11-18')).toEqual(['2026-11']);
  });

  test('weeks start on the given day, padded with null before the 1st and after the last', () => {
    // November 2026 starts on a Sunday and has 30 days.
    const sunday = monthWeeks('2026-11', 0);
    expect(sunday).toHaveLength(5);
    expect(sunday[0]).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(sunday[4]).toEqual(['2026-11-29', '2026-11-30', null, null, null, null, null]);

    const monday = monthWeeks('2026-11', 1);
    expect(monday[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(monday).toHaveLength(6);
    expect(monday[5]).toEqual(['2026-11-30', null, null, null, null, null, null]);
  });

  test('every day of a month appears once, leap years included', () => {
    const days = (month) => monthWeeks(month).flat().filter(Boolean);
    expect(days('2028-02')).toHaveLength(29);
    expect(days('2026-02')).toHaveLength(28);
    expect(days('2026-12').at(-1)).toBe('2026-12-31');
    monthWeeks('2026-12').forEach((week) => expect(week).toHaveLength(7));
  });

  test('the week starts where the locale starts it, Sunday when it can’t be told', () => {
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('en-GB')).toBe(1);
    expect(firstDayOfWeek('not a locale!')).toBe(0);
  });

  test('events are grouped by day, keeping their order', () => {
    const grouped = eventsByDate([on('2026-06-12', 'a'), on('2026-06-12', 'b'), on('2026-06-14', 'c')]);
    expect([...grouped.keys()]).toEqual(['2026-06-12', '2026-06-14']);
    expect(grouped.get('2026-06-12').map((event) => event.id)).toEqual(['a', 'b']);
  });
});

describe('buildIcs', () => {
  const event = (extra = {}) => ({ id: 'ep:10:2:5', date: '2026-06-12', title: 'Severance', detail: 'S2 · E5', url: '/tv-show/10?play=1&season=2&episode=5', ...extra });
  const linesOf = (ics) => ics.split('\r\n');

  test('a valid calendar: CRLF lines, a header, and one all-day VEVENT per event', () => {
    jest.setSystemTime(new Date('2026-06-10T09:30:15.250Z'));
    const ics = buildIcs([event(), event({ id: 'movie:20', date: '2026-12-18', title: 'Dune', detail: 'Movie release', url: '/movie/20' })], 'https://binge.test');

    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(linesOf(ics)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//binge.//Release calendar//EN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:binge. releases',
      'BEGIN:VEVENT',
      'UID:ep:10:2:5@binge',
      'DTSTAMP:20260610T093015Z',
      'DTSTART;VALUE=DATE:20260612',
      'DTEND;VALUE=DATE:20260613',
      'SUMMARY:Severance: S2 · E5',
      'DESCRIPTION:Watch on binge.: https://binge.test/tv-show/10?play=1&season=2&episode=5',
      'URL:https://binge.test/tv-show/10?play=1&season=2&episode=5',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:movie:20@binge',
      'DTSTAMP:20260610T093015Z',
      'DTSTART;VALUE=DATE:20261218',
      'DTEND;VALUE=DATE:20261219',
      'SUMMARY:Dune: Movie release',
      'DESCRIPTION:Watch on binge.: https://binge.test/movie/20',
      'URL:https://binge.test/movie/20',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  test('the same event keeps the same UID across exports, so re-importing updates it', () => {
    const uid = (ics) => linesOf(ics).filter((line) => line.startsWith('UID:'));
    expect(uid(buildIcs([event()], 'https://a'))).toEqual(uid(buildIcs([event({ title: 'Renamed' })], 'https://a')));
    expect(uid(buildIcs([event(), event({ id: 'season:10:3' })], 'https://a'))).toEqual(['UID:ep:10:2:5@binge', 'UID:season:10:3@binge']);
  });

  test('text is escaped the iCalendar way: backslashes, commas, semicolons and new lines', () => {
    const ics = buildIcs([event({ title: 'Love; Death, & Robots', detail: 'Part 1\nPart 2 \\ more' })], 'https://binge.test');
    expect(linesOf(ics)).toContain('SUMMARY:Love\\; Death\\, & Robots: Part 1\\nPart 2 \\\\ more');
  });

  test('the end date is the next day across month, year and leap-day boundaries', () => {
    const end = (date) => linesOf(buildIcs([event({ date })], 'https://b')).find((line) => line.startsWith('DTEND'));
    expect(end('2028-02-28')).toBe('DTEND;VALUE=DATE:20280229');
    expect(end('2028-02-29')).toBe('DTEND;VALUE=DATE:20280301');
    expect(end('2026-02-28')).toBe('DTEND;VALUE=DATE:20260301');
    expect(end('2026-06-30')).toBe('DTEND;VALUE=DATE:20260701');
  });

  test('links point at the current site unless another origin is given', () => {
    const ics = buildIcs([event({ url: '/movie/20' })]);
    expect(linesOf(ics)).toContain(`URL:${window.location.origin}/movie/20`);
    expect(linesOf(ics)).toContain(`DESCRIPTION:Watch on binge.: ${window.location.origin}/movie/20`);
  });

  test('an empty calendar is still a valid file', () => {
    expect(buildIcs([], 'https://b')).toBe('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//binge.//Release calendar//EN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:binge. releases\r\nEND:VCALENDAR\r\n');
  });
});

describe('exportToCalendar', () => {
  const events = [{ id: 'ep:10:2:5', date: '2026-06-12', title: 'Severance', detail: 'S2 · E5', url: '/tv-show/10' }];
  let downloads;

  const readText = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob);
  });

  function setDevice({ canShare, coarse, share }) {
    Object.defineProperty(window.navigator, 'canShare', { value: canShare, configurable: true, writable: true });
    Object.defineProperty(window.navigator, 'share', { value: share, configurable: true, writable: true });
    window.matchMedia = jest.fn(() => ({ matches: coarse }));
  }

  beforeEach(() => {
    downloads = [];
    URL.createObjectURL = jest.fn(() => 'blob:binge/1');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordDownload() {
      downloads.push({ href: this.href, download: this.download });
    });
  });

  afterEach(() => {
    delete window.navigator.canShare;
    delete window.navigator.share;
    delete window.matchMedia;
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
    jest.restoreAllMocks();
  });

  test('on a computer the .ics file downloads, and the link is cleaned up afterwards', async () => {
    await exportToCalendar(events);

    expect(downloads).toEqual([{ href: 'blob:binge/1', download: 'binge-releases.ics' }]);
    const [blob] = URL.createObjectURL.mock.calls[0];
    expect(blob.type).toBe('text/calendar');
    const text = await readText(blob);
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain(`URL:${window.location.origin}/tv-show/10`);

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:binge/1');
  });

  test('a single event downloads under its own file name', async () => {
    await exportToCalendar(events, 'Severance.ics');
    expect(downloads).toEqual([{ href: 'blob:binge/1', download: 'Severance.ics' }]);
  });

  test('on a phone the file goes to the share sheet instead of downloading', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    const canShare = jest.fn(() => true);
    setDevice({ canShare, coarse: true, share });

    await exportToCalendar(events);

    expect(window.matchMedia).toHaveBeenCalledWith('(pointer: coarse)');
    expect(share).toHaveBeenCalledTimes(1);
    const [{ files, title }] = share.mock.calls[0];
    expect(title).toBe('binge. releases');
    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].name).toBe('binge-releases.ics');
    expect(files[0].type).toBe('text/calendar');
    expect(await readText(files[0])).toContain('SUMMARY:Severance: S2 · E5');
    expect(canShare).toHaveBeenCalledWith({ files });
    expect(downloads).toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  test('a computer that can share files still downloads', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    setDevice({ canShare: () => true, coarse: false, share });

    await exportToCalendar(events);

    expect(share).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(1);
  });

  test('a phone that can’t share files downloads instead', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    setDevice({ canShare: () => false, coarse: true, share });

    await exportToCalendar(events);

    expect(share).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(1);
  });

  test('closing the share sheet doesn’t download the file as well', async () => {
    setDevice({ canShare: () => true, coarse: true, share: jest.fn().mockRejectedValue(new DOMException('Share canceled', 'AbortError')) });

    await exportToCalendar(events);

    expect(downloads).toEqual([]);
  });

  test('if sharing fails for another reason, the file downloads instead', async () => {
    setDevice({ canShare: () => true, coarse: true, share: jest.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError')) });

    await exportToCalendar(events);

    expect(downloads).toEqual([{ href: 'blob:binge/1', download: 'binge-releases.ics' }]);
  });
});
