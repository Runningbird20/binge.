const { isReleasedPlexMovie, shouldKeepPlexRecord } = require('../scrapers/plex_importer');
const {
  hasArchiveCoverArt,
  hasCoherentArchiveTitle,
  isResearchOrPeriodicalRecord,
  normalizeArchiveBook,
  normalizeArchiveTitle,
  shouldKeepArchiveBook,
} = require('../scrapers/internet_archive_scraper');

describe('Plex importer filters', () => {
  const referenceDate = new Date('2026-04-08T12:00:00Z');

  test('filters out movies releasing after the reference date', () => {
    expect(
      isReleasedPlexMovie(
        {
          mediaType: 'movie',
          title: 'Future Movie',
          releaseDate: '2026-04-09',
        },
        referenceDate
      )
    ).toBe(false);
  });

  test('keeps movies already released on or before the reference date', () => {
    expect(
      isReleasedPlexMovie(
        {
          mediaType: 'movie',
          title: 'Released Movie',
          releaseDate: '2026-04-08',
        },
        referenceDate
      )
    ).toBe(true);
  });

  test('does not apply the movie release filter to tv records', () => {
    expect(
      shouldKeepPlexRecord(
        {
          mediaType: 'tv',
          title: 'Upcoming Show Season',
          releaseDate: '2026-09-01',
        },
        referenceDate
      )
    ).toBe(true);
  });
});

describe('Internet Archive book filters', () => {
  test('filters out books older than 2000', () => {
    expect(
      shouldKeepArchiveBook({
        title: 'Classic Book',
        year: 1999,
      })
    ).toBe(false);
  });

  test('filters out books without a usable publication year', () => {
    expect(
      shouldKeepArchiveBook({
        title: 'Unknown Date Book',
        year: null,
      })
    ).toBe(false);
  });

  test('filters out books without cover art', () => {
    expect(
      hasArchiveCoverArt({
        title: 'Coverless Book',
        year: 2020,
      })
    ).toBe(false);

    expect(
      shouldKeepArchiveBook({
        title: 'Coverless Book',
        year: 2020,
        genre: 'Science Fiction',
      })
    ).toBe(false);
  });

  test('keeps books from 2000 and newer after normalization', () => {
    const normalized = normalizeArchiveBook(
      {
        identifier: 'modern-book',
        title: 'Modern Book',
        creator: 'Author Name',
      },
      {
        metadata: {
          year: '2007',
          subject: ['Science Fiction'],
          description: 'A modern sci-fi novel.',
        },
      }
    );

    expect(normalized.year).toBe(2007);
    expect(shouldKeepArchiveBook(normalized)).toBe(true);
  });

  test('normalizes noisy archive title prefixes before keeping a book', () => {
    expect(normalizeArchiveTitle('2017 -Garud Puran')).toBe('Garud Puran');
    expect(normalizeArchiveTitle('BK 0041 -Times of India, Mumbai Edition')).toBe(
      'Times of India, Mumbai Edition'
    );
    expect(
      hasCoherentArchiveTitle({
        title: '2017 -Garud Puran',
      })
    ).toBe(true);
  });

  test('filters out research papers and journals', () => {
    expect(
      isResearchOrPeriodicalRecord({
        title: 'Journal Of Computer Science IJCSIS April 2018 Full Volume',
        genre: 'Science',
        subjects: ['computer science'],
      })
    ).toBe(true);

    expect(
      shouldKeepArchiveBook({
        title: '(proto)Physics PhD Thesis: TOE - Quantum Cosmology',
        year: 2019,
        genre: 'Science',
        description: 'PhD thesis',
        subjects: ['physics'],
      })
    ).toBe(false);
  });

  test('does not treat fiction journal titles as research papers', () => {
    expect(
      isResearchOrPeriodicalRecord({
        title: 'Gravity Falls journal 3',
        year: 2016,
        genre: 'Imaginary places -- Juvenile fiction',
        subjects: ['juvenile fiction'],
      })
    ).toBe(false);
  });

  test('filters out magazine and newspaper records even with noisy subject tags', () => {
    expect(
      shouldKeepArchiveBook({
        title: 'Kintsugi Magazine',
        year: 2017,
        genre: 'Science Fiction',
        subjects: ['magazine', 'science fiction'],
      })
    ).toBe(false);

    expect(
      shouldKeepArchiveBook({
        title: 'The Stoutonia Volume 91 [2000-2001]',
        year: 2000,
        genre: 'History',
        subjects: ['College student newspapers and periodicals -- Wisconsin -- Menomonie'],
      })
    ).toBe(false);
  });

  test('filters out research archive and journal-volume dumps', () => {
    expect(
      shouldKeepArchiveBook({
        title: 'ERIC ED475524: New Horizons in Education, 2002',
        year: 2002,
        genre: 'Literature',
        author: 'ERIC',
        description: 'Papers contain references.',
        subjects: ['ERIC Archive'],
      })
    ).toBe(false);

    expect(
      shouldKeepArchiveBook({
        title: 'IJMECS V4-V12',
        year: 2020,
        genre: 'Science',
        description:
          'International Journal of Modern Education and Computer Science (IJMECS) Volume 12 (2020) No 1',
        subjects: ['Computer Science'],
      })
    ).toBe(false);
  });

  test('keeps named books that happen to carry noisy magazine or journal subjects', () => {
    expect(
      shouldKeepArchiveBook({
        title: 'The Astronomy Book Big Ideas Simply Explained',
        year: 2021,
        genre: 'Science',
        coverUrl: 'https://archive.org/services/img/the-astronomy-book-big-ideas-simply-explained',
        subjects: ['English Magazines', 'English Journals', 'Science'],
      })
    ).toBe(true);
  });

  test('filters out titles that still begin with a number after normalization', () => {
    expect(
      shouldKeepArchiveBook({
        title: '1Q84',
        year: 2011,
        genre: 'Science Fiction',
      })
    ).toBe(false);

    expect(
      shouldKeepArchiveBook({
        title: '200 Years Together',
        year: 2002,
        genre: 'History',
      })
    ).toBe(false);
  });

  test('filters out titles that begin with a hash after normalization', () => {
    expect(
      shouldKeepArchiveBook({
        title: '#118 The Tetragrammaton is a Three-Letter Word',
        year: 2025,
        genre: 'History',
        coverUrl: 'https://archive.org/services/img/z_cxviii',
      })
    ).toBe(false);
  });

  test('filters out incoherent archive titles with source artifacts', () => {
    expect(
      hasCoherentArchiveTitle({
        title:
          'AMSCO Advanced Placement United States History 4th 2020 1690305509 D 415bd 5aca 6e 4fc 776ed 9ce 59ef 3ed 97 Anna’s Archive',
      })
    ).toBe(false);
  });
});
