import { ratingTier } from './EpisodeHeatmap';

jest.mock('../api', () => ({ api: { get: jest.fn() } }));
jest.mock('./HScroll', () => () => null);

test('maps ratings to heatmap colors', () => {
  expect(ratingTier(9.4)).toBe('great');
  expect(ratingTier(8)).toBe('good');
  expect(ratingTier(7.9)).toBe('ok');
  expect(ratingTier(6.2)).toBe('meh');
  expect(ratingTier(4)).toBe('bad');
  expect(ratingTier(null)).toBe('none');
});
