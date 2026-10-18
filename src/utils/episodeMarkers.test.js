import { aniListMatches, looksLikeCredits, looksLikeIntroSkip } from './episodeMarkers';

test('an early 15s–3.5min jump is an intro skip', () => {
  expect(looksLikeIntroSkip(42, 132, 2700)).toBe(true);
  expect(looksLikeIntroSkip(42, 50, 2700)).toBe(false); // nudge
  expect(looksLikeIntroSkip(42, 600, 2700)).toBe(false); // skipping a scene
  expect(looksLikeIntroSkip(1500, 1590, 2700)).toBe(false); // mid-episode
});

test('moving on in the last stretch marks the credits', () => {
  expect(looksLikeCredits(2450, 2700)).toBe(true);
  expect(looksLikeCredits(1800, 2700)).toBe(false);
  expect(looksLikeCredits(2690, 2700)).toBe(false); // already at the very end
});

test('AniList only counts when it is a Japanese title of that name', () => {
  const aot = { idMal: 16498, countryOfOrigin: 'JP', title: { english: 'Attack on Titan', romaji: 'Shingeki no Kyojin' }, synonyms: [] };
  expect(aniListMatches(aot, 'Attack on Titan', 1)).toBe(true);
  expect(aniListMatches(aot, 'The Simpsons', 1)).toBe(false);
  expect(aniListMatches({ ...aot, countryOfOrigin: 'US' }, 'Attack on Titan', 1)).toBe(false);
  expect(aniListMatches({ ...aot, title: { english: 'Attack on Titan Season 2' } }, 'Attack on Titan', 2)).toBe(true);
});
