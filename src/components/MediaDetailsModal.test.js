import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MediaDetailsModal from './MediaDetailsModal';
import * as data from '../utils/supabaseData';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });
jest.mock('./EmbedPlayer', () => () => null);
jest.mock('./RemindButton', () => () => null);
jest.mock('./SendToProfileButton', () => () => null);
jest.mock('./OutsideRatings', () => () => null);
jest.mock('./WhereToWatch', () => () => null);
jest.mock('./EpisodeHeatmap', () => () => null);
jest.mock('./FranchiseOrder', () => () => null);
jest.mock('./RateReviewPanel', () => () => null);
jest.mock('../utils/catalogLookup', () => ({ resolveTmdbItems: () => Promise.resolve([]) }));
jest.mock('../utils/adaptations', () => ({ ...jest.requireActual('../utils/adaptations'), findSourceBooks: () => Promise.resolve([]) }));
jest.mock('../utils/tmdb', () => ({ ...jest.requireActual('../utils/tmdb'), fetchTmdbRecommendations: () => Promise.resolve([]) }));

const mockSeasons = [
  { season_number: 1, episode_count: 3, name: 'Season 1', air_date: '2020-01-01' },
  { season_number: 2, episode_count: 2, name: 'Season 2', air_date: '2021-01-01' },
];
const mockEpisodes = {
  1: [1, 2, 3].map((number) => ({ number, title: `One ${number}`, airDate: '2020-01-01' })),
  2: [1, 2].map((number) => ({ number, title: `Two ${number}`, airDate: '2021-01-01' })),
};
jest.mock('../hooks/useTitleDetails', () => ({
  __esModule: true,
  default: () => ({ tmdbId: 1, seasons: mockSeasons }),
  useSeasonEpisodes: (tmdbId, season) => mockEpisodes[season] || null,
}));

jest.mock('../utils/supabaseData', () => ({
  fetchEpisodeProgress: jest.fn(),
  markEpisodesWatched: jest.fn(),
  unmarkEpisodesWatched: jest.fn(),
  upsertSupabaseContinueWatching: jest.fn(),
  updateWatchlistProgress: jest.fn(),
  removeContinueWatchingFor: jest.fn(),
}));

const SHOW = { id: 42, title: 'The Show', media_type: 'tv_show', source_key: 'tmdb:tv:1' };

// A marking button once the episode progress has loaded (until then they're disabled).
async function ready(name) {
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
  return screen.getByRole('button', { name });
}

function open(props = {}) {
  return render(<MediaDetailsModal item={SHOW} mediaType="tv_show" onClose={() => {}} {...props} />);
}

beforeEach(() => {
  Object.values(data).forEach((fn) => fn.mockReset?.());
  data.fetchEpisodeProgress.mockResolvedValue([]);
  data.markEpisodesWatched.mockResolvedValue();
  data.unmarkEpisodesWatched.mockResolvedValue();
  data.upsertSupabaseContinueWatching.mockResolvedValue();
  data.updateWatchlistProgress.mockResolvedValue();
  data.removeContinueWatchingFor.mockResolvedValue();
});

test('Mark season watched saves the season and moves the show on to the next one', async () => {
  open();
  fireEvent.click(await ready('Mark season watched'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Marked 3 episodes watched. Up next: S2 · E1.'));
  expect(data.markEpisodesWatched).toHaveBeenCalledWith({
    mediaId: 42,
    episodes: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 1, episode: 3 }],
  });
  expect(data.upsertSupabaseContinueWatching).toHaveBeenCalledWith({ mediaType: 'tv_show', mediaId: 42, currentSeason: 2, currentEpisode: 1, positionSeconds: 0 });
  expect(data.updateWatchlistProgress).toHaveBeenCalledWith({ mediaType: 'tv_show', mediaId: 42, currentSeason: 2, currentEpisode: 1 });
  expect(screen.getAllByText(/Resume S2 · E1/).length).toBeGreaterThan(0);
  // The list follows to season 2, ready for the next one.
  expect(await screen.findByText('Two 1')).toBeInTheDocument();
});

test('Watched up to here marks earlier seasons too, skips ones already watched, and Undo puts it all back', async () => {
  data.fetchEpisodeProgress.mockResolvedValue([{ season: 1, episode: 1, watched_at: '2026-01-01T00:00:00Z' }]);
  open({ initialSeason: 2 });
  fireEvent.click(await ready('Watched up to episode 1'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Marked 3 episodes watched. Up next: S2 · E2.'));
  const marked = [{ season: 1, episode: 2 }, { season: 1, episode: 3 }, { season: 2, episode: 1 }];
  expect(data.markEpisodesWatched).toHaveBeenCalledWith({ mediaId: 42, episodes: marked });
  expect(screen.getByRole('button', { name: 'Mark episode 1 unwatched' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(data.unmarkEpisodesWatched).toHaveBeenCalledWith({ mediaId: 42, episodes: marked }));
  // It picked up at S2 E1 before (opened there), so it goes back there.
  await waitFor(() => expect(data.upsertSupabaseContinueWatching).toHaveBeenLastCalledWith({ mediaType: 'tv_show', mediaId: 42, currentSeason: 2, currentEpisode: 1, positionSeconds: 0 }));
  expect(await screen.findByRole('button', { name: 'Watched up to episode 1' })).toBeInTheDocument();
});

test('Undo after catching up a show that was never started takes it out of Continue Watching', async () => {
  open();
  fireEvent.click(await ready('Watched up to episode 2'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Up next: S1 · E3.'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(data.removeContinueWatchingFor).toHaveBeenCalledWith({ mediaType: 'tv_show', mediaId: 42 }));
  expect(data.updateWatchlistProgress).toHaveBeenLastCalledWith({ mediaType: 'tv_show', mediaId: 42, currentSeason: null, currentEpisode: null });
});

test('a season already watched can be unmarked, and Undo restores the original watch times', async () => {
  const times = ['2026-03-01T20:00:00Z', null, '2026-03-02T21:00:00Z'];
  data.fetchEpisodeProgress.mockResolvedValue(times.map((watched_at, i) => ({ season: 1, episode: i + 1, watched_at })));
  open();
  const toggle = await ready('Season watched');
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(toggle);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Season 1 marked unwatched.'));
  expect(data.unmarkEpisodesWatched).toHaveBeenCalledWith({ mediaId: 42, episodes: [1, 2, 3].map((episode) => ({ season: 1, episode })) });
  expect(data.upsertSupabaseContinueWatching).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(data.markEpisodesWatched).toHaveBeenCalledWith({
    mediaId: 42,
    episodes: times.map((watchedAt, i) => ({ season: 1, episode: i + 1, watchedAt })),
  }));
});

test('a failed save is undone on screen and says why', async () => {
  data.markEpisodesWatched.mockRejectedValue(new Error('Sign in to keep track of episodes.'));
  open();
  fireEvent.click(await ready('Watched up to episode 1'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sign in to keep track of episodes.'));
  expect(screen.getByRole('button', { name: 'Watched up to episode 1' })).toBeInTheDocument();
  expect(data.upsertSupabaseContinueWatching).not.toHaveBeenCalled();
});

test('marking waits until the watched episodes have loaded', async () => {
  let loaded;
  data.fetchEpisodeProgress.mockReturnValue(new Promise((resolve) => { loaded = resolve; }));
  open();
  expect(await screen.findByRole('button', { name: 'Mark season watched' })).toBeDisabled();
  loaded([{ season: 1, episode: 1, watched_at: '2026-01-01T00:00:00Z' }]);
  fireEvent.click(await ready('Mark season watched'));
  await waitFor(() => expect(data.markEpisodesWatched).toHaveBeenCalledWith({ mediaId: 42, episodes: [{ season: 1, episode: 2 }, { season: 1, episode: 3 }] }));
});

test('browse-only viewers get the episode list without marking controls', async () => {
  open({ allowActions: false });
  expect(await screen.findByText('One 1')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark season watched' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Watched up to/ })).toBeNull();
});
