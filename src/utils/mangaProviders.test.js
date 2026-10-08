import { PROVIDER_LIST, getProvider, providerFor } from './mangaProviders';
import * as mangadexApi from './mangadexApi';
import * as anilist from './anilist';

jest.mock('./mangadexApi', () => ({
  searchManga: jest.fn(),
  getPopular: jest.fn(),
  getMangaChapters: jest.fn(),
  getChapterPages: jest.fn(),
}));
jest.mock('./anilist', () => ({ listOfficial: jest.fn() }));

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({ error: 'nope' }) });

// CRA resets mock implementations before each test, so set them here.
beforeEach(() => {
  global.fetch = jest.fn();
  mangadexApi.searchManga.mockResolvedValue([{ id: 'direct-1', title: 'Direct result' }]);
  mangadexApi.getPopular.mockResolvedValue([]);
  mangadexApi.getMangaChapters.mockResolvedValue([{ id: 'ch-direct' }]);
  mangadexApi.getChapterPages.mockResolvedValue({ pages: ['p1.jpg'], dataSaverPages: [] });
  anilist.listOfficial.mockResolvedValue([]);
});

describe('registry', () => {
  it('every provider implements the same interface', () => {
    PROVIDER_LIST.forEach((provider) => {
      expect(typeof provider.key).toBe('string');
      expect(typeof provider.label).toBe('string');
      expect(['in-app', 'external']).toContain(provider.reading);
      expect(typeof provider.search).toBe('function');
      expect(typeof provider.popular).toBe('function');
      expect(typeof provider.readLinks).toBe('function');
      expect(provider.rows.length).toBeGreaterThan(0);
      provider.rows.forEach((row) => expect(typeof row.load).toBe('function'));
      if (provider.reading === 'in-app') {
        expect(typeof provider.getChapters).toBe('function');
        expect(typeof provider.getPages).toBe('function');
      }
    });
  });
  it('old library entries without a provider open with MangaDex', () => {
    expect(providerFor({ id: 'x' }).key).toBe('mangadex');
    expect(getProvider('nope').key).toBe('mangadex');
    expect(providerFor({ provider: 'webtoon' }).key).toBe('webtoon');
  });
  it('does not include unlicensed aggregator sources', () => {
    expect(PROVIDER_LIST.map((p) => p.key)).toEqual(['mangadex', 'webtoon', 'mangaplus']);
  });
});

describe('MangaDex provider (regression)', () => {
  const mangadex = getProvider('mangadex');

  it('searches through the server proxy and tags results', async () => {
    global.fetch.mockResolvedValue(ok({ results: [{ id: 'a', title: 'Solo Leveling' }] }));
    const results = await mangadex.search('solo');
    expect(global.fetch.mock.calls[0][0]).toBe('/api/manga/search?q=solo');
    expect(results).toEqual([{ provider: 'mangadex', id: 'a', title: 'Solo Leveling' }]);
  });
  it('falls back to the direct client when the proxy fails', async () => {
    global.fetch.mockResolvedValue(fail(502));
    const results = await mangadex.search('solo');
    expect(mangadexApi.searchManga).toHaveBeenCalled();
    expect(results[0]).toMatchObject({ id: 'direct-1', provider: 'mangadex' });
  });
  it('ignores empty searches', async () => {
    await expect(mangadex.search('   ')).resolves.toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('loads chapters and pages in the reader’s shape', async () => {
    global.fetch
      .mockResolvedValueOnce(ok({ chapters: [{ id: 'c1', number: '1' }] }))
      .mockResolvedValueOnce(ok({ pages: ['a.jpg', 'b.jpg'], dataSaverPages: ['a-s.jpg'] }));
    await expect(mangadex.getChapters({ id: 'm1' })).resolves.toEqual([{ id: 'c1', number: '1' }]);
    await expect(mangadex.getPages({ id: 'c1' })).resolves.toEqual({ pages: ['a.jpg', 'b.jpg'], dataSaverPages: ['a-s.jpg'] });
  });
  it('surfaces rate limiting clearly when there is no fallback', async () => {
    global.fetch.mockResolvedValue(fail(429));
    mangadexApi.getChapterPages.mockRejectedValueOnce(Object.assign(new Error('MangaDex error (429)'), { status: 429 }));
    await expect(mangadex.getPages({ id: 'c1' })).rejects.toThrow(/429/);
  });
});

describe('official providers', () => {
  it('query AniList for their own service only', async () => {
    await getProvider('webtoon').search('tower of god');
    expect(anilist.listOfficial).toHaveBeenCalledWith(expect.objectContaining({ siteIds: [43], provider: 'webtoon', search: 'tower of god' }), undefined);
    await getProvider('mangaplus').rows[0].load();
    expect(anilist.listOfficial).toHaveBeenLastCalledWith(expect.objectContaining({ siteIds: [42], provider: 'mangaplus' }), undefined);
  });
  it('put their own reading link first', () => {
    const links = getProvider('mangaplus').readLinks({ readLinks: [{ site: 'VIZ', siteId: 132 }, { site: 'MANGA Plus', siteId: 42 }] });
    expect(links[0].site).toBe('MANGA Plus');
  });
  it('have no in-app chapters (the official reader is used)', () => {
    expect(getProvider('webtoon').getChapters).toBeNull();
    expect(getProvider('mangaplus').getPages).toBeNull();
  });
});
