import { anilistQuery, findWhereToRead, normalizeAniList, readLinksOf } from './anilist';

const MEDIA = {
  id: 30013,
  title: { english: 'One Piece', romaji: 'ONE PIECE' },
  synonyms: [],
  description: 'Gol D. Roger<br>was known as the <i>Pirate King</i>. (Source: VIZ)',
  coverImage: { extraLarge: 'https://img/op.jpg' },
  status: 'RELEASING',
  startDate: { year: 1997 },
  chapters: null,
  genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Extra'],
  countryOfOrigin: 'JP',
  isAdult: false,
  staff: { edges: [{ role: 'Story & Art', node: { name: { full: 'Eiichirou Oda' } } }] },
  externalLinks: [
    { site: 'MANGA Plus', siteId: 42, url: 'https://mangaplus.shueisha.co.jp/titles/700005', language: 'Spanish' },
    { site: 'MANGA Plus', siteId: 42, url: 'https://mangaplus.shueisha.co.jp/titles/100020', language: 'English' },
    { site: 'VIZ', siteId: 132, url: 'https://www.viz.com/one-piece', language: 'English' },
    { site: 'Twitter', siteId: 17, url: 'https://twitter.com/x', language: null },
  ],
};

beforeEach(() => { global.fetch = jest.fn(); });

describe('normalizeAniList', () => {
  it('maps AniList media to the shared manga shape', () => {
    const manga = normalizeAniList(MEDIA, 'mangaplus');
    expect(manga).toMatchObject({
      id: 'al:30013', anilistId: 30013, provider: 'mangaplus', title: 'One Piece', cover: 'https://img/op.jpg',
      status: 'releasing', year: 1997, author: 'Eiichirou Oda', originalLanguage: 'ja', contentRating: 'safe',
    });
    expect(manga.tags).toHaveLength(5);
    expect(manga.description).toBe('Gol D. Roger\nwas known as the Pirate King.');
  });
});

describe('readLinksOf', () => {
  it('keeps official readers only, one per service, English first, free first', () => {
    const links = readLinksOf(MEDIA);
    expect(links.map((l) => l.site)).toEqual(['MANGA Plus', 'VIZ']);
    expect(links[0]).toMatchObject({ url: 'https://mangaplus.shueisha.co.jp/titles/100020', free: true });
  });
  it('can be limited to one service', () => {
    expect(readLinksOf(MEDIA, [132]).map((l) => l.site)).toEqual(['VIZ']);
  });
});

describe('anilistQuery', () => {
  it('turns rate limiting into a friendly error', async () => {
    global.fetch.mockResolvedValue({ status: 429, ok: false, headers: { get: () => '30' }, json: async () => ({}) });
    await expect(anilistQuery('{ rateTest }')).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/busy.*30 seconds/) });
  });
  it('reports network failures', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(anilistQuery('{ networkTest }')).rejects.toMatchObject({ status: 0 });
  });
  it('reports malformed responses / GraphQL errors', async () => {
    global.fetch.mockResolvedValue({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ errors: [{ message: 'Bad field' }] }) });
    await expect(anilistQuery('{ badTest }')).rejects.toThrow('Bad field');
  });
});

describe('findWhereToRead', () => {
  it('uses links already on the item', async () => {
    const links = [{ site: 'WEBTOON', url: 'https://webtoons.com/x', free: true }];
    await expect(findWhereToRead({ readLinks: links })).resolves.toBe(links);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('looks up by AniList id when MangaDex provides one', async () => {
    global.fetch.mockResolvedValue({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ data: { Media: MEDIA } }) });
    const links = await findWhereToRead({ anilistId: 30013, title: 'One Piece' });
    expect(links[0].site).toBe('MANGA Plus');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).variables).toEqual({ id: 30013 });
  });
  it('only accepts an exact title match when searching', async () => {
    global.fetch.mockResolvedValue({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ data: { Page: { media: [{ ...MEDIA, title: { english: 'One Punch-Man' } }] } } }) });
    await expect(findWhereToRead({ title: 'One Piece Party' })).resolves.toEqual([]);
  });
});

describe('shared requests', () => {
  it('a caller aborting does not cancel the request for the next caller', async () => {
    let release;
    global.fetch.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const first = new AbortController();
    const firstCall = anilistQuery('{ sharedTest }', {}, first.signal);
    first.abort();
    await expect(firstCall).rejects.toMatchObject({ name: 'AbortError' });
    const second = anilistQuery('{ sharedTest }', {}, new AbortController().signal);
    release({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ data: { ok: 1 } }) });
    await expect(second).resolves.toEqual({ ok: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
