import { fireEvent, render, screen } from '@testing-library/react';
import Person from './Person';
import { fetchPerson } from '../utils/people';
import { useWatchedKeys } from '../utils/watchedTitles';

jest.mock('react-router-dom', () => ({ ...require('../testUtils/pageTestSetup').routerMock, useParams: () => ({ id: '1892' }) }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ activeProfile: { id: 'p', is_kids: true, settings: { maturity: 'teens' } } }) }));
jest.mock('../components/Navbar', () => () => null);
jest.mock('../components/TitleRow', () => ({ title, items }) => (
  <section aria-label={title}>{items.map((item) => <span key={item.id}>{item.title}</span>)}</section>
));
jest.mock('../utils/people', () => ({ ...jest.requireActual('../utils/people'), fetchPerson: jest.fn() }));
jest.mock('../utils/watchedTitles', () => ({ ...jest.requireActual('../utils/watchedTitles'), useWatchedKeys: jest.fn() }));

beforeEach(() => { useWatchedKeys.mockReturnValue(new Set()); });

const MATT = {
  person: { id: 1892, name: 'Matt Damon', photo: 'https://image.tmdb.org/t/p/h632/m.jpg', department: 'Actor', biography: 'Matthew Paige Damon is an American actor. '.repeat(14), birthday: '1970-10-08', placeOfBirth: 'Cambridge, Massachusetts, USA' },
  rows: [
    { id: 'movies', title: 'Movies with Matt Damon', items: [{ id: 1, title: 'The Martian' }, { id: 2, title: 'Good Will Hunting' }] },
    { id: 'series', title: 'Series with Matt Damon', items: [{ id: 3, title: 'Project Greenlight' }] },
  ],
};

test('shows who they are and their work on binge., for this profile’s maturity level', async () => {
  fetchPerson.mockResolvedValue(MATT);
  render(<Person />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Matt Damon' })).toBeInTheDocument();
  expect(fetchPerson).toHaveBeenCalledWith('1892', { kidsSafe: 'teens' });
  expect(screen.getByText(/^Actor · Born October 8, 1970 in Cambridge, Massachusetts, USA/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Movies with Matt Damon' })).toHaveTextContent('The MartianGood Will Hunting');
  expect(screen.getByRole('region', { name: 'Series with Matt Damon' })).toHaveTextContent('Project Greenlight');
  // A long biography is trimmed until asked for.
  const toggle = screen.getByRole('button', { name: 'Read more' });
  const bio = screen.getByText(/^Matthew Paige Damon is an American actor\./);
  expect(bio).toHaveClass('clamped');
  fireEvent.click(toggle);
  expect(bio).not.toHaveClass('clamped');
  expect(toggle).toHaveTextContent('Show less');
});

test('says so when none of their work is on binge.', async () => {
  fetchPerson.mockResolvedValue({ person: { ...MATT.person, biography: '' }, rows: [] });
  render(<Person />);
  expect(await screen.findByText('None of Matt Damon’s work is on binge. yet.')).toBeInTheDocument();
});

test('someone TMDB doesn’t know', async () => {
  fetchPerson.mockResolvedValue(null);
  render(<Person />);
  expect(await screen.findByText('We couldn’t find that person.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to Home' })).toBeInTheDocument();
});

test('the first row is where this profile has already seen them, best known first', async () => {
  useWatchedKeys.mockReturnValue(new Set(['movie:2', 'tv_show:3']));
  fetchPerson.mockResolvedValue({
    ...MATT,
    work: [{ id: 1, media_type: 'movie', title: 'The Martian' }, { id: 2, media_type: 'movie', title: 'Good Will Hunting' }, { id: 3, media_type: 'tv_show', title: 'Project Greenlight' }],
  });
  render(<Person />);
  const rows = await screen.findAllByRole('region');
  expect(rows[0]).toHaveAccessibleName('Where you’ve seen Matt Damon');
  expect(rows[0]).toHaveTextContent('Good Will HuntingProject Greenlight');
  expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Where you’ve seen Matt Damon', 'Movies with Matt Damon', 'Series with Matt Damon']);
});

test('nothing of theirs watched: no such row', async () => {
  fetchPerson.mockResolvedValue({ ...MATT, work: [{ id: 1, media_type: 'movie', title: 'The Martian' }] });
  render(<Person />);
  await screen.findByRole('region', { name: 'Movies with Matt Damon' });
  expect(screen.queryByRole('region', { name: /^Where you’ve seen/ })).not.toBeInTheDocument();
});
