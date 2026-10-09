import { buildTicketBook, buildWrapped, countPassport } from './wrapped';


const ep = (id, title, day, extra = {}) => ({ media_type: 'tv_show', media_id: id, title, genre: 'Drama', watched_at: `2026-${day}T20:00:00Z`, ...extra });

describe('buildWrapped', () => {
  it('summarizes a year of activity', () => {
    const episodes = [
      ...Array.from({ length: 7 }, () => ep(1, 'Squid Game', '03-14', { original_language: 'ko', genre: 'Drama, Thriller' })),
      ep(2, 'The Bear', '05-02', { genre: 'Comedy' }),
      ep(1, 'Squid Game', '2025-12-01'.slice(5), { watched_at: '2025-12-01T00:00:00Z' }),
    ];
    const ratings = [
      { media_type: 'movie', media_id: 9, title: 'Dune', genre: 'Science Fiction', created_at: '2026-03-20T00:00:00Z', overall_rating: 9 },
    ];
    const w = buildWrapped({ episodes, playing: [], ratings, watchlist: [] }, 2026);
    expect(w.episodeCount).toBe(8);
    expect(w.movieCount).toBe(1);
    expect(w.titleCount).toBe(3);
    expect(w.hours).toBe(Math.round((8 * 45 + 110) / 60));
    expect(w.topShow).toMatchObject({ title: 'Squid Game', episodes: 7 });
    expect(w.busiestMonth).toBe(2);
    expect(w.bingeDay.count).toBe(7);
    expect(w.topGenres[0]).toBe('Drama');
    expect(w.persona.name).toBe('The K-Drama Devotee');
  });

  it('calls out a big single-day binge', () => {
    const episodes = Array.from({ length: 6 }, () => ep(2, 'The Bear', '05-02', { genre: 'Comedy' }));
    const w = buildWrapped({ episodes, playing: [], ratings: [], watchlist: [] }, 2026);
    expect(w.persona.name).toBe('The Marathoner');
  });

  it('is empty when nothing happened this year', () => {
    const w = buildWrapped({ episodes: [], playing: [], ratings: [], watchlist: [] }, 2026);
    expect(w.titleCount).toBe(0);
    expect(w.topShow).toBeNull();
  });
});

describe('ticket book', () => {
  const ep = (id, date) => ({ media_type: 'tv_show', media_id: id, title: `Show ${id}`, watched_at: date, genre: 'Drama' });
  const now = new Date('2026-05-20T12:00:00');

  test('monthly stubs count episodes and mark future months', () => {
    const book = buildTicketBook({
      episodes: [ep(1, '2026-01-03T20:00:00'), ep(1, '2026-01-04T20:00:00'), ep(2, '2026-03-01T20:00:00')],
      playing: [], ratings: [], watchlist: [],
    }, 2026, now);
    expect(book.monthly[0]).toMatchObject({ episodes: 2, titles: 1, future: false });
    expect(book.monthly[0].top.title).toBe('Show 1');
    expect(book.monthly[5].future).toBe(true);
  });

  test('achievements track progress toward a goal', () => {
    const day = Array.from({ length: 7 }, (_, i) => ep(1, `2026-02-10T0${i}:30:00`));
    const book = buildTicketBook({ episodes: day, playing: [], ratings: [], watchlist: [] }, 2026, now);
    const marathon = book.achievements.find((a) => a.key === 'marathon');
    expect(marathon.earned).toBe(true);
    expect(book.achievements.find((a) => a.key === 'night')).toMatchObject({ progress: 4, earned: false });
  });

  test('passport counts each country once per title', () => {
    expect(countPassport([
      { production_countries: [{ iso_3166_1: 'KR' }], origin_country: ['KR'] },
      { production_countries: [{ iso_3166_1: 'US' }, { iso_3166_1: 'GB' }] },
      { origin_country: ['KR'] },
    ])).toEqual([{ code: 'KR', count: 2 }, { code: 'US', count: 1 }, { code: 'GB', count: 1 }]);
  });
});
