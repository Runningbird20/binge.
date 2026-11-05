import { fetchPerson, lifeLine, titlePeople, workCredits } from './people';
import { tmdbGet } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';

jest.mock('./tmdb', () => ({ ...jest.requireActual('./tmdb'), tmdbGet: jest.fn() }));
jest.mock('./catalogLookup', () => ({ resolveTmdbItems: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test('a movie’s photo row: the director first, then the cast in billing order, each person once', () => {
  const people = titlePeople({
    credits: {
      crew: [{ id: 1, name: 'Steven Soderbergh', job: 'Director', profile_path: '/s.jpg' }, { id: 9, name: 'A Writer', job: 'Screenplay' }],
      cast: [
        { id: 3, name: 'Brad Pitt', character: 'Rusty Ryan', order: 1, profile_path: '/b.jpg' },
        { id: 2, name: 'George Clooney', character: 'Danny Ocean', order: 0, profile_path: '/g.jpg' },
        { id: 1, name: 'Steven Soderbergh', character: 'Himself', order: 9 },
        { id: 4, name: 'No Photo', character: 'Tony Stark / Iron Man', order: 2 },
      ],
    },
  }, 'movie');
  expect(people.map((p) => [p.name, p.role])).toEqual([
    ['Steven Soderbergh', 'Director'],
    ['George Clooney', 'Danny Ocean'],
    ['Brad Pitt', 'Rusty Ryan'],
    ['No Photo', 'Tony Stark'],
  ]);
  expect(people[0].photo).toBe('https://image.tmdb.org/t/p/w185/s.jpg');
  expect(people[3].photo).toBeNull();
});

test('a series leads with its creators', () => {
  const people = titlePeople({ created_by: [{ id: 7, name: 'Vince Gilligan' }], credits: { cast: [{ id: 8, name: 'Bryan Cranston', character: 'Walter White' }] } }, 'tv_show');
  expect(people.map((p) => [p.name, p.role])).toEqual([['Vince Gilligan', 'Creator'], ['Bryan Cranston', 'Walter White']]);
  expect(titlePeople(null, 'movie')).toEqual([]);
});

test('someone’s work: real scripted roles, series of 3+ episodes, most widely known first', () => {
  const { acting, directing } = workCredits({
    cast: [
      { id: 1, media_type: 'movie', character: 'Hero', vote_count: 10 },
      { id: 2, media_type: 'movie', character: 'Himself', vote_count: 900 },
      { id: 3, media_type: 'tv', character: 'Guest', episode_count: 1, vote_count: 50 },
      { id: 4, media_type: 'tv', character: 'Lead', episode_count: 10, vote_count: 500 },
      { id: 5, media_type: 'tv', character: 'Panelist', genre_ids: [10767], episode_count: 40, vote_count: 700 },
      { id: 1, media_type: 'movie', character: 'Hero (voice)', vote_count: 10 },
      { id: 6, media_type: 'tv', character: 'Cameo', episode_count: 1, vote_count: 900 },
    ],
    crew: [
      { id: 10, media_type: 'movie', job: 'Director', vote_count: 5 },
      { id: 11, media_type: 'movie', job: 'Producer', vote_count: 99 },
      { id: 12, media_type: 'tv', job: 'Creator', vote_count: 40 },
      { id: 13, media_type: 'tv', job: 'Director', episode_count: 1, vote_count: 400 }, // one episode
    ],
  });
  expect(acting.map((c) => c.id)).toEqual([4, 1]);
  expect(directing.map((c) => c.id)).toEqual([12, 10]);
});

test('the person page: their work on binge. as rows, a director’s own work first', async () => {
  tmdbGet.mockResolvedValue({
    id: 138, name: 'Quentin Tarantino', known_for_department: 'Directing', profile_path: '/q.jpg', biography: 'Bio.', birthday: '1963-03-27', place_of_birth: 'Knoxville, Tennessee, USA',
    combined_credits: {
      cast: [{ id: 500, media_type: 'movie', character: 'Mr. Brown', vote_count: 9000 }],
      crew: [{ id: 680, media_type: 'movie', job: 'Director', vote_count: 20000 }, { id: 500, media_type: 'movie', job: 'Director', vote_count: 9000 }],
    },
  });
  resolveTmdbItems.mockImplementation(async (results, mediaType) => results.map((r) => ({ id: r.tmdbId * 10, media_type: mediaType, title: `T${r.tmdbId}`, _tmdb: { tmdbId: r.tmdbId } })));
  const page = await fetchPerson(138, { kidsSafe: 'teens' });
  expect(tmdbGet).toHaveBeenCalledWith('/person/138', { append_to_response: 'combined_credits' });
  expect(resolveTmdbItems).toHaveBeenCalledWith(expect.any(Array), 'movie', { kidsSafe: 'teens' });
  expect(page.person).toMatchObject({ name: 'Quentin Tarantino', department: 'Director', photo: 'https://image.tmdb.org/t/p/h632/q.jpg' });
  expect(page.rows.map((row) => [row.title, row.items.map((item) => item.title)])).toEqual([
    ['Directed by Quentin Tarantino', ['T680', 'T500']],
    ['Movies with Quentin Tarantino', ['T500']],
  ]);
});

test('nothing for someone TMDB doesn’t know', async () => {
  tmdbGet.mockResolvedValue(null);
  await expect(fetchPerson(1)).resolves.toBeNull();
});

test('the life line under the name', () => {
  const now = new Date('2026-11-05T12:00:00');
  expect(lifeLine({ birthday: '1961-05-06', placeOfBirth: 'Lexington, Kentucky, USA' }, now)).toBe('Born May 6, 1961 in Lexington, Kentucky, USA (age 65)');
  expect(lifeLine({ birthday: '1961-12-06' }, now)).toBe('Born December 6, 1961 (age 64)');
  expect(lifeLine({ birthday: '1932-02-27', deathday: '2021-07-21' }, now)).toBe('1932 – 2021');
  expect(lifeLine({ placeOfBirth: 'Paris' }, now)).toBe('Born in Paris');
  expect(lifeLine({}, now)).toBe('');
});
