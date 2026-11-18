import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SurpriseButtons from './SurpriseButtons';
import { buildGroupPicks } from '../../utils/personalization';
import { mockNavigate } from '../../testUtils/pageTestSetup';

jest.mock('react-router-dom', () => require('../../testUtils/pageTestSetup').routerMock, { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../utils/watchedTitles', () => ({ useWatchedKeys: () => new Set(['movie:9']) }));
jest.mock('../../utils/personalization', () => ({ buildGroupPicks: jest.fn() }));
jest.mock('../../utils/haptics', () => ({ haptic: () => {} }));
jest.mock('../TitleCard', () => ({ titleUrl: (item) => `/${item.media_type === 'tv_show' ? 'tv-show' : 'movie'}/${item.id}` }));

const SAM = { id: 'p1', name: 'Sam', is_default: true, is_kids: false };
const ALEX = { id: 'p2', name: 'Alex', is_default: false, is_kids: false };
const KIDS = { id: 'p3', name: 'Kids', is_default: false, is_kids: true, settings: { maturity: 'kids' } };
const movie = (id) => ({ id, media_type: 'movie', title: `Movie ${id}` });
// One pick each, so what's picked is certain.
const PERSONAL = { topPicks: [movie(1), { id: 2, media_type: 'tv_show', title: 'Series 2' }], becauseYouWatched: [] };

let mockAuth;

beforeEach(() => {
  mockAuth = { activeProfile: SAM, profiles: [SAM, ALEX, KIDS] };
  mockNavigate.mockReset();
  buildGroupPicks.mockReset().mockResolvedValue({ picks: [movie(77)], exclude: new Set(), hasHistory: true });
});

const renderButtons = () => render(<SurpriseButtons personal={PERSONAL} fallback={[]} />);
const openAsk = () => fireEvent.click(screen.getByRole('button', { name: 'Surprise me with a movie' }));

test('an account with one profile is surprised straight away', () => {
  mockAuth = { activeProfile: SAM, profiles: [SAM] };
  renderButtons();
  openAsk();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mockNavigate).toHaveBeenCalledWith('/movie/1', expect.anything());
});

test('otherwise it asks “Just you?”, with the other profiles to choose from', () => {
  renderButtons();
  openAsk();
  const dialog = screen.getByRole('dialog', { name: 'Just you?' });
  expect(dialog).toHaveTextContent('we’ll find a movie you’d all like that none of you has seen');
  expect(screen.getByRole('button', { name: 'Alex' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Kids' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sam' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Just me' })).toHaveFocus();
});

test('“Just me” is the usual surprise', () => {
  renderButtons();
  openAsk();
  fireEvent.click(screen.getByRole('button', { name: 'Just me' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(buildGroupPicks).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith('/movie/1', expect.anything());
});

test('with someone chosen, the surprise is for both of you, and the choice is kept for next time', async () => {
  renderButtons();
  openAsk();
  fireEvent.click(screen.getByRole('button', { name: 'Alex' }));
  fireEvent.click(screen.getByRole('button', { name: 'Surprise Alex and me' }));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/movie/77', expect.anything()));
  expect(buildGroupPicks).toHaveBeenCalledWith({
    profiles: [{ id: 'p1', ownsLegacy: true }, { id: 'p2', ownsLegacy: false }],
    mediaType: 'movie',
    kidsSafe: false,
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  openAsk();
  expect(screen.getByRole('button', { name: 'Alex' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Surprise Alex and me' })).toHaveFocus();
});

test('with a kids profile along, movies keep to the youngest viewer’s rating, and it says so; three or more is “all of us”', async () => {
  renderButtons();
  openAsk();
  fireEvent.click(screen.getByRole('button', { name: 'Alex' }));
  expect(screen.queryByText(/^Picks keep to/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Kids' }));
  expect(screen.getByText('Picks keep to Kids’s rating (Kids).')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Surprise all 3 of us' }));
  await waitFor(() => expect(buildGroupPicks).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'movie', kidsSafe: 'kids' })));
});

test('series keep to the youngest viewer’s rating too', async () => {
  renderButtons();
  fireEvent.click(screen.getByRole('button', { name: 'Surprise me with a series' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('a series you’d all like');
  fireEvent.click(screen.getByRole('button', { name: 'Kids' }));
  fireEvent.click(screen.getByRole('button', { name: 'Surprise Kids and me' }));
  await waitFor(() => expect(buildGroupPicks).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'tv_show', kidsSafe: 'kids' })));
});

test('with no history to go on, your trending titles stand in, but never past a stricter viewer’s rating', async () => {
  buildGroupPicks.mockResolvedValue({ picks: [], exclude: new Set(['movie:30']), hasHistory: false });
  const trending = [movie(30), movie(31)];
  render(<SurpriseButtons personal={PERSONAL} fallback={trending} />);

  // Two grown-ups: trending (already rated for you), less what either has seen.
  openAsk();
  fireEvent.click(screen.getByRole('button', { name: 'Alex' }));
  fireEvent.click(screen.getByRole('button', { name: 'Surprise Alex and me' }));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/movie/31', expect.anything()));

  // With Kids along, trending was never filtered for Kids: nothing is picked.
  mockNavigate.mockReset();
  openAsk();
  fireEvent.click(screen.getByRole('button', { name: 'Kids' }));
  fireEvent.click(screen.getByRole('button', { name: 'Surprise all 3 of us' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t find a movie none of you has seen.');
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('nothing none of them has seen: it says so and the question stays', async () => {
  buildGroupPicks.mockResolvedValue({ picks: [], exclude: new Set(), hasHistory: true });
  renderButtons();
  openAsk();
  fireEvent.click(screen.getByRole('button', { name: 'Alex' }));
  fireEvent.click(screen.getByRole('button', { name: 'Surprise Alex and me' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t find a movie none of you has seen. Try with fewer people.');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('closing it while the picks load drops them', async () => {
  let finish;
  buildGroupPicks.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  renderButtons();
  openAsk();
  fireEvent.click(screen.getByRole('button', { name: 'Alex' }));
  fireEvent.click(screen.getByRole('button', { name: 'Surprise Alex and me' }));
  expect(screen.getByRole('status')).toHaveTextContent('Finding something you’d all like…');

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => finish({ picks: [movie(77)], exclude: new Set(), hasHistory: true }));
  expect(mockNavigate).not.toHaveBeenCalled();
});
