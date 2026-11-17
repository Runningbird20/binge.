import { describeRequest, readableRequest } from './errorRequests';

const COLUMNS = 'select=id%2Ctitle%2Cyear%2Cgenre%2Coverview%2Cposter_url%2Csource_key%2Cage_rating%2Coriginal_language';

test('a catalog lookup by TMDB id reads as the table, its columns and the list it asked for', () => {
  const raw = `GET /api/catalog/rest/tv_shows?${COLUMNS}&source_key=in.%28%22tmdb%3Atv%3A323026%22%2C%22tmdb%3Atv%3A61431%22%2C%22tmdb%3Atv%3A8988%22%2C%22tmdb%3Atv%3A252%22%29`;
  expect(describeRequest(raw)).toEqual({
    method: 'GET',
    target: 'catalog tv_shows',
    details: ['9 columns', 'source_key in 4 values (tmdb:tv:323026, tmdb:tv:61431, tmdb:tv:8988, …)'],
  });
});

test('ids, orders, limits and comparisons', () => {
  const raw = 'GET /api/catalog/rest/movies?select=id%2Ctitle&id=in.%28113567%2C66282%29&vote_average=gte.7&order=popularity.desc.nullslast&limit=20';
  expect(describeRequest(raw).details).toEqual([
    'columns id, title',
    'id in 2 values (113567, 66282)',
    'vote_average ≥ 7',
    'order popularity desc',
    'limit 20',
  ]);
});

test('a page address from the browser keeps just its path and settings', () => {
  expect(describeRequest('https://binge-26.vercel.app/movies?view=all&genre=Science%20Fiction')).toEqual({
    method: '',
    target: '/movies',
    details: ['view = all', 'genre = Science Fiction'],
  });
});

test('the full request decodes, for when every value matters', () => {
  expect(readableRequest('GET /api/catalog/rest/movies?id=in.%28615%2C12545%29')).toBe('GET /api/catalog/rest/movies?id=in.(615,12545)');
  expect(readableRequest('GET /broken%E0%A4%A')).toBe('GET /broken%E0%A4%A'); // not decodable: left as is
});
