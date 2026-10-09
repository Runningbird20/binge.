import { feedFamily, rankFeeds, recordFeedFailed, recordFeedWorked } from './sportsServerMemory';

const admin1 = { id: 'streamed', source: 'admin', matchId: 'm', embedUrl: 'https://e/admin/1', label: 'Streamed · admin 1 HD' };
const golf1 = { id: 'streamed', source: 'golf', matchId: 'm', embedUrl: 'https://e/golf/1', label: 'Streamed · golf 1 HD' };
const ppv = { id: 'ppv', embedUrl: 'https://p/x', label: 'PPV · SkyCast' };

beforeEach(() => localStorage.clear());

test('families group streams of one source', () => {
  expect(feedFamily(admin1)).toBe('streamed:admin');
  expect(feedFamily({ ...admin1, embedUrl: 'https://e/admin/2' })).toBe('streamed:admin');
  expect(feedFamily(ppv)).toBe('ppv:skycast');
});

test('keeps the original order with no history', () => {
  expect(rankFeeds([ppv, admin1, golf1], 'g')).toEqual([ppv, admin1, golf1]);
});

test('feeds that worked move up, failed ones down, across games', () => {
  recordFeedWorked(golf1, 'other-game');
  recordFeedFailed(ppv, 'other-game');
  expect(rankFeeds([ppv, admin1, golf1], 'g')).toEqual([golf1, admin1, ppv]);
});

test('the server that last worked for this game comes first', () => {
  recordFeedWorked(golf1, 'g');
  recordFeedWorked(admin1, 'x');
  recordFeedWorked(admin1, 'y');
  expect(rankFeeds([ppv, admin1, golf1], 'g')[0]).toBe(golf1);
  recordFeedFailed(golf1, 'g');
  expect(rankFeeds([ppv, admin1, golf1], 'g')[0]).toBe(admin1);
});
