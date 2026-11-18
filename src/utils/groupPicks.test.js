import { buildGroupPicks, groupScore } from './personalization';
import { strictestProfile, strictestRestriction } from './kidsMode';
import {
  fetchEpisodeProgressCounts, fetchHiddenRecommendations, fetchSupabaseContinueWatching,
  fetchSupabaseRatings, fetchSupabaseWatchlist, fetchWatchedTitleKeys,
} from './supabaseData';
import { fetchDiscover, fetchTmdbRecommendations, fetchTmdbSimilar } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';

jest.mock('./supabaseData', () => ({
  fetchSupabaseRatings: jest.fn(),
  fetchSupabaseWatchlist: jest.fn(),
  fetchSupabaseContinueWatching: jest.fn(),
  fetchEpisodeProgressCounts: jest.fn(),
  fetchHiddenRecommendations: jest.fn(),
  fetchWatchedTitleKeys: jest.fn(),
  averageRatingValue: (rating) => rating.stars,
}));
jest.mock('./tmdb', () => ({
  ...jest.requireActual('./tmdb'),
  fetchTmdbRecommendations: jest.fn(),
  fetchTmdbSimilar: jest.fn(),
  fetchDiscover: jest.fn(),
}));
jest.mock('./catalogLookup', () => ({ resolveTmdbItems: jest.fn() }));

// Sam loves science fiction (Arrival), Alex loves comedy (Booksmart).
const SAM = { id: 'sam', ownsLegacy: true };
const ALEX = { id: 'alex', ownsLegacy: false };
const rated = (mediaId, tmdbId, title, genre) => ({ media_type: 'movie', media_id: mediaId, title, genre, source_key: `tmdb:movie:${tmdbId}`, stars: 5, created_at: new Date().toISOString() });
const RATINGS = { sam: [rated(1, 101, 'Arrival', 'Science Fiction')], alex: [rated(2, 102, 'Booksmart', 'Comedy')] };
const WATCHED = { sam: ['movie:1'], alex: ['movie:2', 'movie:5'] };

// The catalog, by TMDB id.
const CATALOG = {
  201: { id: 5, title: 'Seen by Alex', genre: 'Science Fiction, Comedy' },
  202: { id: 6, title: 'Both of us', genre: 'Science Fiction, Comedy' },
  203: { id: 7, title: 'Just comedy', genre: 'Comedy' },
  204: { id: 8, title: 'Just science fiction', genre: 'Science Fiction' },
};
const result = (tmdbId) => ({ tmdbId, mediaType: 'movie', voteAverage: 7, popularity: 50 });
const RECOMMENDED = { 101: [result(201), result(202), result(204)], 102: [result(202), result(203)] };

beforeEach(() => {
  const forProfile = (table, empty) => async ({ profile } = {}) => table[profile?.id] || empty;
  fetchSupabaseRatings.mockImplementation(forProfile(RATINGS, []));
  fetchSupabaseWatchlist.mockResolvedValue([]);
  fetchSupabaseContinueWatching.mockResolvedValue([]);
  fetchEpisodeProgressCounts.mockResolvedValue(new Map());
  fetchHiddenRecommendations.mockResolvedValue([]);
  fetchWatchedTitleKeys.mockImplementation(async ({ profile }) => new Set(WATCHED[profile.id] || []));
  fetchTmdbRecommendations.mockImplementation(async (mediaType, tmdbId) => RECOMMENDED[tmdbId] || []);
  fetchTmdbSimilar.mockResolvedValue([]);
  fetchDiscover.mockResolvedValue([]);
  resolveTmdbItems.mockImplementation(async (results) => results
    .filter((entry) => CATALOG[entry.tmdbId])
    .map((entry) => ({ ...CATALOG[entry.tmdbId], media_type: 'movie', _tmdb: entry })));
});

test('a title one would love and the other would dislike scores below one they’d both like', () => {
  expect(groupScore([1, 1])).toBe(1);
  expect(groupScore([2, 0])).toBe(0); // mean 1, spread 2
  expect(groupScore([1.2, 0.8])).toBeCloseTo(0.8);
  expect(groupScore([])).toBe(0);
});

test('two profiles: what they’d both like comes first, and nothing either has watched', async () => {
  const { picks, exclude, hasHistory } = await buildGroupPicks({ profiles: [SAM, ALEX], mediaType: 'movie', kidsSafe: 'kids' });

  expect(hasHistory).toBe(true);
  expect(picks.map((item) => item.title)).toEqual(['Both of us', expect.any(String), expect.any(String)]);
  expect(picks.map((item) => item.title)).not.toContain('Seen by Alex');
  expect([...exclude].sort()).toEqual(['movie:1', 'movie:2', 'movie:5']);
  // No "Because you watched …": it would tell one what the other watched.
  picks.forEach((item) => {
    expect(item).not.toHaveProperty('_seed');
    expect(item).not.toHaveProperty('_reason');
  });
  // Each history was read as that profile, at the group's level.
  expect(fetchSupabaseRatings).toHaveBeenCalledWith({ profile: ALEX });
  expect(fetchWatchedTitleKeys).toHaveBeenCalledWith({ profile: SAM });
  expect(resolveTmdbItems).toHaveBeenCalledWith(expect.any(Array), 'movie', { kidsSafe: 'kids' });
});

test('nobody with a history: no picks, but what they’ve watched is still known', async () => {
  fetchSupabaseRatings.mockResolvedValue([]);
  const { picks, exclude, hasHistory } = await buildGroupPicks({ profiles: [{ id: 'new1', ownsLegacy: true }, { id: 'new2', ownsLegacy: false }], mediaType: 'tv_show' });
  expect(hasHistory).toBe(false);
  expect(picks).toEqual([]);
  expect(exclude.size).toBe(0);
  expect(fetchTmdbRecommendations).not.toHaveBeenCalled();
});

test('series for a group are matched at the group’s level too', async () => {
  await buildGroupPicks({ profiles: [SAM, ALEX], mediaType: 'tv_show', kidsSafe: 'toddler' });
  expect(resolveTmdbItems).toHaveBeenCalledWith(expect.any(Array), 'tv_show', { kidsSafe: 'toddler' });
  expect(resolveTmdbItems).not.toHaveBeenCalledWith(expect.any(Array), expect.anything(), { kidsSafe: false });
});

test('a group gets the youngest viewer’s rating: the strictest of its maturity levels', () => {
  const adult = { is_kids: false };
  const teen = { is_kids: true, settings: { maturity: 'teens' } };
  const kid = { is_kids: true, settings: { maturity: 'kids' } };
  expect(strictestRestriction([adult, adult])).toBe(false);
  expect(strictestRestriction([adult, teen])).toBe('teens');
  expect(strictestRestriction([teen, kid, adult])).toBe('kids');
  expect(strictestRestriction([])).toBe(false);
  expect(strictestProfile([adult, kid, teen])).toBe(kid);
  expect(strictestProfile([adult, adult])).toBeNull();
});
