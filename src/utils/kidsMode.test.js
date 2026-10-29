import { isChildLevel, maturityRestriction, profileMaturity, ratingsFor } from './kidsMode';

test('is_kids is the master switch; settings.maturity picks the level', () => {
  expect(profileMaturity({ is_kids: false, settings: { maturity: 'toddler' } })).toBe('all');
  expect(profileMaturity({ is_kids: true })).toBe('kids');
  expect(profileMaturity({ is_kids: true, settings: { maturity: 'teens' } })).toBe('teens');
  expect(profileMaturity({ is_kids: true, settings: { maturity: 'bogus' } })).toBe('kids');
  expect(maturityRestriction({ is_kids: false })).toBe(false);
  expect(maturityRestriction({ is_kids: true, settings: { maturity: 'toddler' } })).toBe('toddler');
});

test('each level allows its ratings', () => {
  expect(ratingsFor(false)).toBeNull();
  expect(ratingsFor('toddler')).toEqual(['G', 'TV-Y']);
  expect(ratingsFor(true)).toContain('TV-PG');
  expect(ratingsFor('kids')).not.toContain('PG-13');
  expect(ratingsFor('teens')).toEqual(expect.arrayContaining(['PG-13', 'TV-14', 'G']));
  expect(ratingsFor('teens')).not.toContain('R');
});

test('only toddler and kids get the kids-only rows', () => {
  expect(isChildLevel('toddler')).toBe(true);
  expect(isChildLevel('kids')).toBe(true);
  expect(isChildLevel(true)).toBe(true);
  expect(isChildLevel('teens')).toBe(false);
  expect(isChildLevel(false)).toBe(false);
});
