import { act, fireEvent, render, screen } from '@testing-library/react';
import EmbedPlayer from './EmbedPlayer';
import useDeviceType from '../hooks/useDeviceType';
import { useMiniPlayer } from '../contexts/MiniPlayerContext';
import * as supabaseData from '../utils/supabaseData';
import * as streamPreferences from '../utils/streamPreferences';
import { api } from '../api';
import { reachabilityMap } from '../utils/hostReachability';
import { fetchTmdbLanguageInfo } from '../utils/tmdb';
import { useSeasonEpisodes } from '../hooks/useTitleDetails';
import * as episodeMarkers from '../utils/episodeMarkers';
import { expectedRuntimeSeconds } from '../utils/runtimeCheck';

const { markEpisodeWatched, fetchEpisodeProgress } = supabaseData;
const { submitStreamReport } = streamPreferences;

// Pins down the player's behaviour (rendered output, Up Next, failover,
// buffering, episode picking, minimize, keyboard) with the network mocked and
// the server ranking, URL building and message parsing real.

jest.mock('../hooks/useDeviceType', () => jest.fn());
jest.mock('../contexts/MiniPlayerContext', () => ({ useMiniPlayer: jest.fn() }));
jest.mock('../api', () => ({
  api: { get: jest.fn() },
}));
jest.mock('../utils/supabaseData', () => ({
  fetchEpisodeProgress: jest.fn(),
  markEpisodeWatched: jest.fn(),
  unmarkEpisodeWatched: jest.fn(),
  upsertSupabaseContinueWatching: jest.fn(),
  updateWatchlistProgress: jest.fn(),
  fetchSupabaseResumePoint: jest.fn(),
}));
jest.mock('../utils/streamPreferences', () => ({
  ...jest.requireActual('../utils/streamPreferences'),
  fetchReportSummary: jest.fn(),
  fetchProviderHealth: jest.fn(),
  fetchDisabledServers: jest.fn(),
  submitStreamReport: jest.fn(),
}));
jest.mock('../utils/hostReachability', () => ({ reachabilityMap: jest.fn() }));
jest.mock('../utils/tmdb', () => ({
  ...jest.requireActual('../utils/tmdb'),
  fetchTmdbLanguageInfo: jest.fn(),
}));
jest.mock('../hooks/useTitleDetails', () => ({
  useSeasonEpisodes: jest.fn(),
}));
jest.mock('../utils/episodeMarkers', () => ({
  ...jest.requireActual('../utils/episodeMarkers'),
  fetchEpisodeMarkers: jest.fn(),
  reportCredits: jest.fn(),
  reportIntro: jest.fn(),
}));
jest.mock('../utils/runtimeCheck', () => ({
  ...jest.requireActual('../utils/runtimeCheck'),
  expectedRuntimeSeconds: jest.fn(),
}));

const SHOW = { id: 42, title: 'The Show', seasons: 2, source_key: 'tmdb:tv:1399', poster_url: 'https://img/p.jpg', original_language: 'en' };
const MOVIE = { id: 7, title: 'The Film', year: 2010, source_key: 'tmdb:movie:27205', original_language: 'en' };

let mini;
async function flush(ms = 0) {
  await act(async () => {
    if (ms) jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function setup({ item = SHOW, mediaType = 'tv_show', mobile = false, landscape = false, watched = [{ season: 1, episode: 1 }] } = {}) {
  useDeviceType.mockReturnValue({ isMobile: mobile, isLandscape: landscape });
  fetchEpisodeProgress.mockResolvedValue(watched);
  const onClose = jest.fn();
  const view = render(<EmbedPlayer item={item} mediaType={mediaType} onClose={onClose} initialSeason={1} initialEpisode={1} />);
  await flush();
  await flush();
  return { ...view, onClose };
}
// The server's player (titled "Watch …"), not the next episode's hidden preload frame.
const frame = () => screen.getByTitle(/^Watch /);
function post(data) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: frame().contentWindow }));
  });
}
// A PLAYER_EVENT-style progress message (what VidLink/Videasy send).
const progress = (time, duration = 2600, event = 'timeupdate') => ({ type: 'PLAYER_EVENT', data: { event, currentTime: time, duration } });
const vidrift = (time, duration = 2600) => ({ type: 'vidrift:progress', currentTime: time, duration });

// CRA resets mock implementations before every test, so set them here.
beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  mini = { showMini: jest.fn(), closeMini: jest.fn() };
  useMiniPlayer.mockReturnValue(mini);
  api.get.mockImplementation((path) => {
    if (path.startsWith('/media/tmdb-show')) return Promise.resolve({ numberOfSeasons: 2 });
    if (path.startsWith('/media/tmdb-season')) return Promise.resolve({ episodeCount: 10 });
    return Promise.resolve({});
  });
  for (const name of ['markEpisodeWatched', 'unmarkEpisodeWatched', 'upsertSupabaseContinueWatching', 'updateWatchlistProgress']) {
    supabaseData[name].mockResolvedValue();
  }
  supabaseData.fetchSupabaseResumePoint.mockResolvedValue(null);
  streamPreferences.fetchReportSummary.mockResolvedValue([]);
  streamPreferences.fetchProviderHealth.mockResolvedValue({});
  streamPreferences.fetchDisabledServers.mockResolvedValue(new Set());
  streamPreferences.submitStreamReport.mockResolvedValue();
  reachabilityMap.mockResolvedValue({});
  fetchTmdbLanguageInfo.mockResolvedValue(null);
  useSeasonEpisodes.mockReturnValue([{ number: 2, title: 'The Next One', still: null }]);
  episodeMarkers.fetchEpisodeMarkers.mockResolvedValue({});
  expectedRuntimeSeconds.mockResolvedValue(null);
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test('desktop TV player', async () => {
  const { container } = await setup();
  expect(container.innerHTML).toMatchSnapshot();
});

test('desktop movie player', async () => {
  const { container } = await setup({ item: MOVIE, mediaType: 'movie' });
  expect(container.innerHTML).toMatchSnapshot();
});

test('phone TV player, portrait and landscape with the episode picker open', async () => {
  const { container, unmount } = await setup({ mobile: true });
  expect(container.innerHTML).toMatchSnapshot('portrait');
  unmount();
  const landscape = await setup({ mobile: true, landscape: true });
  fireEvent.click(screen.getByRole('button', { name: 'Episodes and servers' }));
  expect(landscape.container.innerHTML).toMatchSnapshot('landscape');
});

test('picking an episode from the desktop popover loads it', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: /S1 · E1/ }));
  expect(screen.getByRole('dialog', { name: 'Season and episode selector' }).outerHTML).toMatchSnapshot();
  fireEvent.click(screen.getByRole('button', { name: '3' }));
  await flush();
  expect(frame().getAttribute('src')).toMatchSnapshot();
  expect(screen.queryByRole('dialog', { name: 'Season and episode selector' })).toBeNull();
});

test('Up Next appears near the end and plays the next episode after the countdown', async () => {
  await setup({ watched: [] });
  const firstSrc = frame().getAttribute('src');
  post(vidrift(100));
  post(vidrift(2590));
  await flush(1000);
  expect(screen.getByRole('dialog', { name: 'Up next' }).outerHTML).toMatchSnapshot();
  for (let i = 0; i < 11; i += 1) await flush(1000);
  expect(markEpisodeWatched).toHaveBeenCalledWith({ mediaId: 42, season: 1, episode: 1 });
  expect(frame().getAttribute('src')).not.toBe(firstSrc);
  expect(frame().getAttribute('src')).toMatchSnapshot();
});

test('a server that never reports playback fails over to the next one', async () => {
  await setup();
  const before = frame().getAttribute('src');
  await flush(25000);
  expect(submitStreamReport).toHaveBeenCalledWith(expect.objectContaining({ mediaId: 42, works: false }));
  expect(screen.getByRole('status').textContent).toMatchSnapshot();
  expect(frame().getAttribute('src')).not.toBe(before);
});

test('buffering offers a switch, then switches on its own', async () => {
  await setup();
  post(vidrift(100));
  post({ type: 'vidrift:unpaused', currentTime: 100 });
  await flush(14000);
  expect(screen.getByRole('status').textContent).toMatchSnapshot('offer');
  await flush(18000);
  expect(screen.getByRole('status').textContent).toMatchSnapshot('switched');
});

test('keyboard: arrows change episode, Escape closes the popover then the player', async () => {
  const { onClose } = await setup();
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  await flush();
  expect(screen.getByRole('button', { name: /S1 · E2/ })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /S1 · E1/ }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});

test('mark as watched toggles the current episode', async () => {
  await setup({ watched: [] });
  fireEvent.click(screen.getByRole('button', { name: /Mark as watched/ }));
  await flush();
  expect(markEpisodeWatched).toHaveBeenCalledWith({ mediaId: 42, season: 1, episode: 1 });
  expect(screen.getByRole('button', { name: /Watched/ })).toBeInTheDocument();
});

test('opening the player closes the mini-player', async () => {
  await setup({ item: MOVIE, mediaType: 'movie' });
  expect(mini.closeMini).toHaveBeenCalled();
});

test('seen playback (PLAYER_EVENT) cancels failover; a frozen clock is buffering instead', async () => {
  await setup({ item: MOVIE, mediaType: 'movie' });
  const before = frame().getAttribute('src');
  post(progress(50, 6000, 'play'));
  await flush(25000);
  // One notice only: the buffering offer, no failover.
  expect(screen.getByRole('status').textContent).toMatchSnapshot();
  expect(frame().getAttribute('src')).toBe(before);
});

test('Skip intro shows inside the intro and jumps to its end', async () => {
  episodeMarkers.fetchEpisodeMarkers.mockResolvedValue({ intro: { start: 60, end: 150 } });
  await setup();
  const before = frame().getAttribute('src');
  post(vidrift(70));
  await flush(500);
  const skip = screen.getByRole('button', { name: /^Skip intro$/ });
  const hide = screen.getByRole('button', { name: 'Hide Skip intro' });
  expect([skip.outerHTML, hide.outerHTML]).toMatchSnapshot();
  fireEvent.click(skip);
  await flush();
  expect(screen.queryByRole('button', { name: /^Skip intro$/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hide Skip intro' })).toBeNull();
  expect(frame().getAttribute('src')).not.toBe(before);
  expect(frame().getAttribute('src')).toMatchSnapshot();
});

test('a server playing a different-length video is replaced', async () => {
  expectedRuntimeSeconds.mockResolvedValue(2700);
  await setup();
  post(vidrift(100, 900));
  await flush();
  expect(screen.getByRole('status').textContent).toMatchSnapshot();
  expect(submitStreamReport).toHaveBeenCalledWith(expect.objectContaining({ mediaId: 42, works: false }));
});

// VidRift's own Next button, Episodes menu or Up Next: it switches episodes itself and says so.
const vidriftEpisode = (season, episode) => ({ type: 'vidrift:episode', tmdbId: 1399, mediaType: 'tv', season, episode });

test('an episode picked inside VidRift becomes the one the site tracks, without reloading the player', async () => {
  await setup({ watched: [] });
  const src = frame().getAttribute('src');
  post(vidriftEpisode(1, 4));
  await flush();
  expect(screen.getByRole('button', { name: /S1 · E4/ })).toBeInTheDocument();
  expect(frame().getAttribute('src')).toBe(src);
  // A late message from the episode it left doesn't switch the site back.
  post({ ...vidrift(600), tmdbId: 1399, mediaType: 'tv', season: 1, episode: 1 });
  await flush();
  expect(screen.getByRole('button', { name: /S1 · E4/ })).toBeInTheDocument();
  // Picking an episode on the site loads it, as always.
  fireEvent.click(screen.getByRole('button', { name: /S1 · E4/ }));
  fireEvent.click(screen.getByRole('button', { name: '6' }));
  await flush();
  expect(frame().getAttribute('src')).toMatch(/[?&]e=6\b/);
});

test('a switch inside VidRift whose message was missed is caught from its next progress message', async () => {
  await setup();
  post({ ...vidrift(30), tmdbId: 1399, mediaType: 'tv', season: 2, episode: 1 });
  await flush();
  expect(screen.getByRole('button', { name: /S2 · E1/ })).toBeInTheDocument();
});
