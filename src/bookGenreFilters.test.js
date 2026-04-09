const {
  buildBookGenreFacets,
  matchesBookGenreFacet,
  normalizeBookGenreFacet,
} = require('../server/bookGenres');

describe('book genre helpers', () => {
  test('groups fiction-like labels under Fiction', () => {
    expect(normalizeBookGenreFacet('Science Fiction')).toBe('Fiction');
    expect(normalizeBookGenreFacet('Historical Fiction')).toBe('Fiction');
    expect(normalizeBookGenreFacet('Man-woman relationships -- Fiction')).toBe('Fiction');
  });

  test('keeps non-fiction labels out of the Fiction bucket', () => {
    expect(normalizeBookGenreFacet('Non-Fiction')).toBe('Non-Fiction');
    expect(normalizeBookGenreFacet('none fiction')).toBe('Non-Fiction');
  });

  test('builds narrowed facet options with Fiction grouped once', () => {
    expect(
      buildBookGenreFacets([
        'Science Fiction',
        'Historical Fiction',
        'Mystery',
        'Non-Fiction',
        'Man-woman relationships -- Fiction',
        'Andrae, A',
      ])
    ).toEqual(['Fiction', 'General Interest', 'Mystery', 'Non-Fiction']);
  });

  test('matches Fiction filters against broader fiction-like genres', () => {
    expect(matchesBookGenreFacet('Science Fiction', 'Fiction')).toBe(true);
    expect(matchesBookGenreFacet('Man-woman relationships -- Fiction', 'Fiction')).toBe(true);
    expect(matchesBookGenreFacet('Non-Fiction', 'Fiction')).toBe(false);
  });
});
