jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });
jest.mock('../components/Navbar', () => () => null);
jest.mock('../components/FantasyBoard', () => () => null);
jest.mock('../utils/sportsProviders', () => ({ ...jest.requireActual('../utils/sportsProviders'), loadSportsStreams: jest.fn() }));
jest.mock('../utils/liveScores', () => ({ ...jest.requireActual('../utils/liveScores'), fetchScoreboards: jest.fn() }));
jest.mock('../utils/teams', () => ({ ...jest.requireActual('../utils/teams'), listFollowedTeams: jest.fn() }));
// jsdom has no network, so the real probe would call every server blocked.
jest.mock('../utils/hostReachability', () => ({ ...jest.requireActual('../utils/hostReachability'), reachabilityMap: jest.fn(), isHostReachable: jest.fn() }));

import { render, screen, waitFor } from '@testing-library/react';
import Sports from './Sports';
import { loadSportsStreams } from '../utils/sportsProviders';
import { fetchScoreboards } from '../utils/liveScores';
import { listFollowedTeams } from '../utils/teams';
import { isHostReachable, reachabilityMap } from '../utils/hostReachability';
import { setMockSearchParams } from '../testUtils/pageTestSetup';

const now = Math.floor(Date.now() / 1000);
const GAME = {
  id: 'basketball|lakers_celtics|live',
  name: 'Lakers vs Celtics',
  category: 'basketball',
  league: 'NBA',
  startsAt: now - 1800,
  endsAt: now + 3600,
  live: true,
  upcoming: false,
  providers: [{ id: 'ppv', label: 'PPV', embedUrl: 'https://example.com/embed/lakers-celtics' }],
};
const OTHER = {
  ...GAME,
  id: 'basketball|knicks_bulls|live',
  name: 'Knicks vs Bulls',
  providers: [{ id: 'ppv', label: 'PPV', embedUrl: 'https://example.com/embed/knicks-bulls' }],
};
const frames = () => [...document.querySelectorAll('iframe')].map((frame) => frame.getAttribute('src'));

// Implementations go here, not in jest.mock: CRA's Jest config resets mocks before each test.
beforeEach(() => {
  window.localStorage.clear();
  fetchScoreboards.mockResolvedValue(new Map());
  listFollowedTeams.mockResolvedValue([]);
  reachabilityMap.mockResolvedValue({});
  isHostReachable.mockResolvedValue(true);
  loadSportsStreams.mockImplementation(async (onUpdate) => {
    onUpdate?.([GAME, OTHER]);
    return [GAME, OTHER];
  });
});
afterEach(() => setMockSearchParams(''));

// A smoke test for the page and the pieces in components/sports/ (cards, rows,
// spotlight): a live game shows up as the spotlight and as a card.
test('the Sports page shows a live game in the spotlight and its rows', async () => {
  render(<Sports />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Lakers vs Celtics' })).toBeInTheDocument();
  expect(screen.getAllByText('Lakers vs Celtics').length).toBeGreaterThan(1);
  expect(screen.getAllByText(/live/i).length).toBeGreaterThan(0);
});

test('?game= opens the player on the game’s server', async () => {
  setMockSearchParams(`game=${GAME.id}`);
  render(<Sports />);
  expect(await screen.findByTitle('Lakers vs Celtics')).toBeInTheDocument();
  expect(frames()).toContain('https://example.com/embed/lakers-celtics');
});

test('?multi= opens Multiview with a tile per game', async () => {
  setMockSearchParams(`multi=${GAME.id},${OTHER.id}`);
  render(<Sports />);
  await waitFor(() => expect(frames()).toEqual(expect.arrayContaining(['https://example.com/embed/lakers-celtics', 'https://example.com/embed/knicks-bulls'])));
});
