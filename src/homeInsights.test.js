import { buildHomeInsights, buildRecapNarrative } from './homeInsights';

const sampleRatings = [
  {
    media_type: 'movie',
    media_id: 1,
    title: 'Harry Potter and the Sorcerer\'s Stone',
    genre: 'Fantasy, Adventure',
    created_at: '2026-01-09 10:00:00',
  },
  {
    media_type: 'movie',
    media_id: 2,
    title: 'Harry Potter and the Chamber of Secrets',
    genre: 'Fantasy, Adventure',
    created_at: '2026-02-11 10:00:00',
  },
  {
    media_type: 'movie',
    media_id: 3,
    title: 'Harry Potter and the Prisoner of Azkaban',
    genre: 'Fantasy, Adventure',
    created_at: '2026-03-03 10:00:00',
  },
  {
    media_type: 'book',
    media_id: 4,
    title: 'Harry Potter and the Prisoner of Azkaban',
    genre: 'Fantasy',
    created_at: '2026-03-15 10:00:00',
  },
  {
    media_type: 'tv_show',
    media_id: 5,
    title: 'The Bear',
    genre: 'Drama',
    created_at: '2026-04-07 10:00:00',
  },
  {
    media_type: 'movie',
    media_id: 6,
    title: 'Dune',
    genre: 'Science Fiction',
    created_at: '2025-11-21 10:00:00',
  },
];

const sampleWatchlist = [
  {
    id: 1,
    media_type: 'movie',
    title: 'Harry Potter and the Sorcerer\'s Stone',
    status: 'watched',
  },
  {
    id: 2,
    media_type: 'movie',
    title: 'Harry Potter and the Chamber of Secrets',
    status: 'watched',
  },
  {
    id: 3,
    media_type: 'movie',
    title: 'Harry Potter and the Prisoner of Azkaban',
    status: 'watched',
  },
  {
    id: 4,
    media_type: 'movie',
    title: 'Harry Potter and the Goblet of Fire',
    status: 'watched',
  },
  {
    id: 5,
    media_type: 'book',
    title: 'Harry Potter and the Prisoner of Azkaban',
    status: 'read',
  },
  {
    id: 6,
    media_type: 'tv_show',
    title: 'The Bear',
    status: 'watched',
  },
  {
    id: 7,
    media_type: 'movie',
    title: 'Arrival',
    status: 'plan_to_watch',
  },
];

test('buildHomeInsights returns tiered badges from completed library items and recap data from ratings', () => {
  const insights = buildHomeInsights(sampleRatings, sampleWatchlist);

  expect(insights.availableYears).toEqual([2026, 2025]);
  expect(insights.selectedYear).toBe(2026);
  expect(insights.earnedBadgeCount).toBe(4);

  expect(insights.badges.find((badge) => badge.id === 'completion-collector')).toEqual(
    expect.objectContaining({
      completed: true,
      displayTier: expect.objectContaining({
        key: 'bronze',
        label: 'Bronze',
      }),
      progressLabel: '6 / 15',
      progressCaption: 'Toward Silver',
    })
  );

  expect(insights.badges.find((badge) => badge.id === 'film-centurion')).toEqual(
    expect.objectContaining({
      completed: false,
      progressLabel: '4 / 100',
      tierSummary: 'Working toward Bronze',
    })
  );

  expect(insights.badges.find((badge) => badge.id === 'trilogy-finisher')).toEqual(
    expect.objectContaining({
      completed: true,
      displayTier: expect.objectContaining({
        key: 'silver',
        label: 'Silver',
      }),
      detail: 'Best series progress: Harry Potter (4 watched films).',
      progressCaption: 'Toward Gold',
    })
  );

  expect(insights.badges.find((badge) => badge.id === 'book-and-film')).toEqual(
    expect.objectContaining({
      completed: true,
      displayTier: expect.objectContaining({
        key: 'bronze',
      }),
      detail: 'Matched Harry Potter and the Prisoner of Azkaban.',
    })
  );

  expect(insights.recap).toEqual(
    expect.objectContaining({
      year: 2026,
      totalLogged: 5,
      activeMonths: 4,
      busiestMonth: expect.objectContaining({
        label: 'Mar',
        count: 2,
      }),
      countsByType: {
        movie: 3,
        tv_show: 1,
        book: 1,
      },
    })
  );

  expect(insights.recap.topGenres[0]).toEqual(
    expect.objectContaining({
      label: 'Fantasy',
      count: 4,
    })
  );
});

test('buildHomeInsights can switch the recap to an older year', () => {
  const insights = buildHomeInsights(sampleRatings, sampleWatchlist, 2025);

  expect(insights.selectedYear).toBe(2025);
  expect(insights.recap.totalLogged).toBe(1);
  expect(insights.recap.countsByType).toEqual({
    movie: 1,
    tv_show: 0,
    book: 0,
  });
  expect(buildRecapNarrative(insights.recap)).toBe(
    'You logged 1 title in 2025. You showed up in 1 month. Nov was your busiest month with 1 log.'
  );
});
