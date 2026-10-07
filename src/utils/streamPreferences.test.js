import { rankServers, wantedAudio } from './streamPreferences';

const IDS = ['vidsrc', 'vidsrc2', '2embed', 'vidlink'];

test('original-language preference resolves to the title language', () => {
  expect(wantedAudio({ audio: 'original' }, 'ko')).toBe('ko');
  expect(wantedAudio({ audio: 'en' }, 'ko')).toBe('en');
});

test('a server reported with the wanted audio outranks the default order', () => {
  const ranked = rankServers(IDS, {
    prefs: { audio: 'original', subtitles: 'en' },
    originalLanguage: 'ko',
    summary: [
      { provider: 'vidsrc', works_count: 4, broken_count: 0, audio_lang: 'fr', audio_count: 3 },
      { provider: 'vidlink', works_count: 2, broken_count: 0, audio_lang: 'ko', audio_count: 2 },
    ],
  });
  expect(ranked[0].id).toBe('vidlink');
  expect(ranked[ranked.length - 1].id).toBe('vidsrc');
});

test('the server that worked for this profile last time wins', () => {
  const ranked = rankServers(IDS, {
    prefs: { audio: 'original' },
    originalLanguage: 'ko',
    memory: { provider: '2embed', audio: 'ko', at: Date.now() },
  });
  expect(ranked[0].id).toBe('2embed');
  expect(ranked[0].note).toMatch(/last time/i);
});

test('a server this profile just marked broken drops to the bottom', () => {
  const ranked = rankServers(IDS, {
    prefs: { audio: 'original' },
    originalLanguage: 'en',
    memory: { 'broken:vidsrc': Date.now() },
  });
  expect(ranked[ranked.length - 1].id).toBe('vidsrc');
});
