import { foreignCaptionLang, pickVidriftSubtitle, subtitleFileUrl } from './foreignCaptions';

test('captions come on only for titles in another language', () => {
  expect(foreignCaptionLang('en', 'ml')).toBe('en');
  expect(foreignCaptionLang('en', 'en')).toBeNull();
  expect(foreignCaptionLang('en-US', 'en')).toBeNull();
  expect(foreignCaptionLang('off', 'ml')).toBeNull();
  expect(foreignCaptionLang(null, 'ko')).toBeNull();
  expect(foreignCaptionLang('en', null)).toBeNull();
});

test('the subtitle file URL names the title, episode and language', () => {
  expect(subtitleFileUrl({ origin: 'https://binge.test', tmdbId: 1084812, isTV: false, lang: 'en' }))
    .toBe('https://binge.test/api/extras/subtitles?type=movie&tmdb=1084812&lang=en&format=vtt');
  expect(subtitleFileUrl({ origin: 'https://binge.test', tmdbId: 93405, isTV: true, season: 2, episode: 3, lang: 'en' }))
    .toBe('https://binge.test/api/extras/subtitles?type=tv&tmdb=93405&lang=en&format=vtt&season=2&episode=3');
  expect(subtitleFileUrl({ origin: 'https://binge.test', tmdbId: null, lang: 'en' })).toBeNull();
});

test("picks VidRift's track for the language, as its lists name them", () => {
  // Seen on Kireedam (1989) and Aavesham (2024), 2026-11-19.
  const own = [{ value: 'off', label: 'Off' }, { value: 'en', label: 'English' }, { value: 'en-2', label: 'English 2' }, { value: 'x2', label: 'Malayalam' }];
  const mirrored = [{ value: 'off', label: 'Off' }, { value: 'mb-en', label: 'English · Orion' }, { value: 'mb-hi', label: 'हिन्दी · Orion' }];
  expect(pickVidriftSubtitle(own, 'en')).toBe('en');
  expect(pickVidriftSubtitle(mirrored, 'en')).toBe('mb-en');
  expect(pickVidriftSubtitle([{ value: 'x9', label: 'English (SDH)' }], 'en', 'English')).toBe('x9');
  expect(pickVidriftSubtitle([{ value: 'off', label: 'Off' }], 'en')).toBeNull();
  expect(pickVidriftSubtitle(undefined, 'en')).toBeNull();
});
