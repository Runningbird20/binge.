import { buildUrl, PROVIDERS, PROVIDER_HOSTS } from './embedProviders';
import { EMBED_SERVERS } from './embedServers';

const FIGHT_CLUB = { kind: 'tmdb', value: '550' };

test('the player uses the shared server list (the uptime probe reads the same one)', () => {
  expect(PROVIDERS).toBe(EMBED_SERVERS);
  expect(Object.keys(PROVIDER_HOSTS)).toEqual(EMBED_SERVERS.map((server) => server.id));
});

test('CineSrc gets the subtitle language by name, not by code', () => {
  const url = new URL(buildUrl('cinesrc', FIGHT_CLUB, 'movie', 1, 1, 'es'));
  expect(url.searchParams.get('subtitlelang')).toBe('Spanish');
  expect(url.searchParams.get('subtitles')).toBe('auto');
});

test('VidSrc Classic still gets the subtitle language as a code', () => {
  const url = new URL(buildUrl('vidsrc-embed-ru', FIGHT_CLUB, 'movie', 1, 1, 'es'));
  expect(url.searchParams.get('ds_lang')).toBe('es');
});

test('without a subtitle language, no subtitle parameters are sent', () => {
  const url = new URL(buildUrl('cinesrc', FIGHT_CLUB, 'movie', 1, 1));
  expect(url.searchParams.has('subtitlelang')).toBe(false);
});
