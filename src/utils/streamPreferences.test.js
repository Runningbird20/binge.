import { rankServers, setCaptionCapableServers, summarizeHealth, wantedAudio } from './streamPreferences';

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

describe('provider health', () => {
  it('flags a provider many viewers could not play today', () => {
    expect(summarizeHealth({ works_24h: 1, broken_24h: 4, works_7d: 10, broken_7d: 6 }).down).toBe(true);
    expect(summarizeHealth({ works_24h: 3, broken_24h: 3, works_7d: 10, broken_7d: 6 }).down).toBe(false);
    expect(summarizeHealth({ works_24h: 0, broken_24h: 0, works_7d: 8, broken_7d: 2 }).usuallyWorks).toBe(true);
  });

  it('ranks a broadly-down server last and labels it', () => {
    const health = { vidlink: { down: true }, vidrift: { usuallyWorks: true } };
    const ranking = rankServers(['vidlink', 'vidrift', 'vidy'], { prefs: { audio: 'original' }, health });
    expect(ranking[ranking.length - 1]).toMatchObject({ id: 'vidlink', status: 'down' });
    expect(ranking.find((s) => s.id === 'vidrift')).toMatchObject({ status: 'ok', note: 'Usually works' });
  });

  it('prefers title-specific evidence over global health', () => {
    const summary = [{ provider: 'vidlink', works_count: 2, broken_count: 0 }];
    const ranking = rankServers(['vidlink'], { prefs: { audio: 'original' }, summary, health: { vidlink: { down: true } } });
    expect(ranking[0].status).toBe('good');
  });
});

describe('captions first', () => {
  it('lifts caption-capable servers when subtitles are on, not when off', () => {
    setCaptionCapableServers(['cinesrc']);
    const on = rankServers(['vidlink', 'cinesrc'], { prefs: { audio: 'original', subtitles: 'en' }, health: {} });
    expect(on[0].id).toBe('cinesrc');
    const off = rankServers(['vidlink', 'cinesrc'], { prefs: { audio: 'original', subtitles: 'off' }, health: {} });
    expect(off[0].id).toBe('vidlink');
  });
});
