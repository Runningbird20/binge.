import { pickWatchProviders, providerFamily, serviceName, watchRegion, withPlainLogos } from './watchProviders';
import { tmdbGet } from './tmdb';

jest.mock('./tmdb', () => ({ tmdbGet: jest.fn() }));

const p = (provider_id, provider_name, display_priority = 10) => ({ provider_id, provider_name, display_priority, logo_path: `/${provider_id}.png` });

test('country comes from the browser languages, US when none says', () => {
  expect(watchRegion(['en-GB', 'en'])).toBe('GB');
  expect(watchRegion(['fr', 'pt-BR'])).toBe('BR');
  expect(watchRegion(['en'])).toBe('US');
  expect(watchRegion([])).toBe('US');
});

test('tiers, ad plans and resold channels are one service', () => {
  const same = (...names) => expect(new Set(names.map(providerFamily)).size).toBe(1);
  same('Netflix', 'Netflix Standard with Ads', 'Netflix Kids');
  same('Paramount Plus Premium', 'Paramount Plus Essential', 'Paramount+ Amazon Channel', 'Paramount Plus Apple TV channel', 'Paramount+ Roku Premium Channel');
  same('Peacock Premium', 'Peacock Premium Plus', 'Peacock Premium Plus Amazon Channel');
  same('HBO Max', 'HBO Max Amazon Channel');
  same('Amazon Prime Video', 'Amazon Prime Video with Ads', 'Amazon Prime Video Free with Ads');
  same('AMC+', 'AMC Plus Apple TV channel');
  same('Apple TV', 'Apple TV Store', 'Apple TV Amazon Channel'); // one Apple TV logo
  expect(providerFamily('Disney Plus')).toBe('disney plus');
});

test('everything from YouTube is one service with the regular YouTube logo', () => {
  ['YouTube', 'YouTube TV', 'YouTube Free', 'YouTube Premium'].forEach((name) => {
    expect(providerFamily(name)).toBe('youtube');
    expect(serviceName(name)).toBe('YouTube');
  });
  const watch = pickWatchProviders({ results: { US: { flatrate: [p(2528, 'YouTube TV', 1)], free: [p(235, 'YouTube Free', 2)] } } }, 'US');
  expect(watch.providers).toHaveLength(1);
  expect(watch.providers[0]).toMatchObject({ name: 'YouTube', plain: false });
});

test('Amazon MX Player is never shown', () => {
  const watch = pickWatchProviders({ results: { US: { ads: [p(2593, 'Amazon MX Player', 1), p(73, 'Tubi TV', 2)], free: [p(2594, 'MX Player', 3)] } } }, 'US');
  expect(watch.providers.map((x) => x.name)).toEqual(['Tubi TV']);
  expect(pickWatchProviders({ results: { US: { ads: [p(2593, 'Amazon MX Player', 1)] } } }, 'US')).toBeNull();
});

test('names are the plain service', () => {
  expect(serviceName('Netflix Standard with Ads')).toBe('Netflix');
  expect(serviceName('HBO Max Amazon Channel')).toBe('HBO Max');
  expect(serviceName('Paramount Plus Premium')).toBe('Paramount+');
});

test('one logo per service, the plain one when it is listed, streaming first, at most six', () => {
  const data = { results: { US: {
    link: 'https://www.themoviedb.org/tv/1396/watch?locale=US',
    flatrate: [p(1796, 'Netflix Standard with Ads', 5), p(8, 'Netflix', 6), p(15, 'Hulu', 3), p(2303, 'Paramount Plus Premium', 7), p(2616, 'Paramount Plus Essential', 8)],
    ads: [p(73, 'Tubi TV', 20)],
    free: [p(300, 'Pluto TV', 30), p(538, 'Plex', 40), p(207, 'The Roku Channel', 50)],
    buy: [p(2, 'Apple TV Store', 2)],
  } } };
  const watch = pickWatchProviders(data, 'US');
  expect(watch.how).toBe('stream');
  expect(watch.providers.map((x) => x.name)).toEqual(['Hulu', 'Netflix', 'Paramount+', 'Tubi TV', 'Pluto TV', 'Plex']);
  const netflix = watch.providers.find((x) => x.family === 'netflix');
  expect(netflix).toMatchObject({ id: 8, logo: '/8.png', plain: true });
  expect(watch.providers.filter((x) => x.family === 'paramount plus')).toHaveLength(1);
});

test('rent or buy only when nothing streams; nothing for another country', () => {
  const data = { results: { US: { rent: [p(10, 'Amazon Video', 2)], buy: [p(10, 'Amazon Video', 2), p(2, 'Apple TV Store', 1)] } } };
  const watch = pickWatchProviders(data, 'US');
  expect(watch.how).toBe('rent');
  expect(watch.providers.map((x) => [x.name, x.kinds])).toEqual([['Apple TV', ['Buy']], ['Amazon Video', ['Rent', 'Buy']]]);
  expect(pickWatchProviders(data, 'GB')).toBeNull();
  expect(pickWatchProviders(undefined, 'US')).toBeNull();
});

test('a title listing only a variant gets the plain service logo from TMDB’s list', async () => {
  tmdbGet.mockResolvedValue({ results: [p(8, 'Netflix'), p(1796, 'Netflix Standard with Ads'), p(1899, 'HBO Max')] });
  const watch = pickWatchProviders({ results: { US: { flatrate: [p(1796, 'Netflix Standard with Ads'), p(1825, 'HBO Max Amazon Channel')] } } }, 'US');
  expect(watch.providers.every((x) => !x.plain)).toBe(true);
  const resolved = await withPlainLogos(watch, 'tv_show', 'US');
  expect(tmdbGet).toHaveBeenCalledWith('/watch/providers/tv', { watch_region: 'US' });
  expect(resolved.providers.map((x) => [x.name, x.logo])).toEqual([['Netflix', '/8.png'], ['HBO Max', '/1899.png']]);
});

test('the plain logo can come from the other type’s list (plain YouTube is only listed for movies)', async () => {
  tmdbGet.mockReset();
  tmdbGet.mockImplementation(async (path) => (path === '/watch/providers/movie' ? { results: [p(192, 'YouTube')] } : { results: [p(2528, 'YouTube TV')] }));
  const watch = pickWatchProviders({ results: { US: { flatrate: [p(2528, 'YouTube TV')] } } }, 'US');
  const resolved = await withPlainLogos(watch, 'tv_show', 'US');
  expect(tmdbGet).toHaveBeenCalledWith('/watch/providers/movie', { watch_region: 'US' });
  expect(resolved.providers.map((x) => [x.name, x.logo, x.plain])).toEqual([['YouTube', '/192.png', true]]);
});
