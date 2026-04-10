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

test('buildHomeInsights returns milestone badges and a recap for the newest year by default', () => {
  const insights = buildHomeInsights(sampleRatings);

  expect(insights.availableYears).toEqual([2026, 2025]);
  expect(insights.selectedYear).toBe(2026);
  expect(insights.earnedBadgeCount).toBe(4);

  expect(insights.badges.find((badge) => badge.id === 'film-centurion')).toEqual(
    expect.objectContaining({
      earned: false,
      progressLabel: '4 / 100',
    })
  );

  expect(insights.badges.find((badge) => badge.id === 'trilogy-finisher')).toEqual(
    expect.objectContaining({
      earned: true,
      detail: 'Best progress: Harry Potter (3 of 3).',
    })
  );

  expect(insights.badges.find((badge) => badge.id === 'book-and-film')).toEqual(
    expect.objectContaining({
      earned: true,
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
  const insights = buildHomeInsights(sampleRatings, 2025);

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
