import { feedFamily, rankFeeds, recordFeedFailed, recordFeedWorked } from './sportsServerMemory';

const hd = { id: 'streamfree', embedUrl: 'https://sf/1080', label: 'StreamFree 1080p' };
const sd = { id: 'streamfree', embedUrl: 'https://sf/720', label: 'StreamFree 720p' };
const ppv = { id: 'ppv', embedUrl: 'https://p/x', label: 'PPV · SkyCast' };

beforeEach(() => localStorage.clear());

test('a family is the provider and its label, whatever the stream', () => {
  expect(feedFamily(ppv)).toBe('ppv:skycast');
  expect(feedFamily({ ...ppv, embedUrl: 'https://p/y' })).toBe('ppv:skycast');
  expect(feedFamily(hd)).toBe('streamfree:streamfree 1080p');
  expect(feedFamily(null)).toBe('');
});

test('keeps the original order with no history', () => {
  expect(rankFeeds([ppv, hd, sd], 'g')).toEqual([ppv, hd, sd]);
});

test('feeds that worked move up, failed ones down, across games', () => {
  recordFeedWorked(sd, 'other-game');
  recordFeedFailed(ppv, 'other-game');
  expect(rankFeeds([ppv, hd, sd], 'g')).toEqual([sd, hd, ppv]);
});

test('the server that last worked for this game comes first', () => {
  recordFeedWorked(sd, 'g');
  recordFeedWorked(hd, 'x');
  recordFeedWorked(hd, 'y');
  expect(rankFeeds([ppv, hd, sd], 'g')[0]).toBe(sd);
  recordFeedFailed(sd, 'g');
  expect(rankFeeds([ppv, hd, sd], 'g')[0]).toBe(hd);
});
