function compactWhitespace(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function normalizeGenreText(value) {
  const normalized = compactWhitespace(value);
  if (!normalized) return null;

  return normalized
    .toLowerCase()
    .replace(/[-_]+/g, ' ');
}

function isNonFictionGenre(value) {
  const normalized = normalizeGenreText(value);
  if (!normalized) return false;

  return (
    normalized.includes('nonfiction') ||
    normalized.includes('non fiction') ||
    normalized.includes('none fiction')
  );
}

function isFictionGenre(value) {
  const normalized = normalizeGenreText(value);
  if (!normalized || isNonFictionGenre(normalized)) {
    return false;
  }

  return normalized.includes('fiction');
}

const BOOK_GENRE_BUCKETS = [
  {
    label: 'Non-Fiction',
    test: (value) => isNonFictionGenre(value),
  },
  {
    label: 'Fiction',
    test: (value) => isFictionGenre(value),
  },
  {
    label: 'Biography',
    test: (value) => /biography|memoir|autobiograph/i.test(value || ''),
  },
  {
    label: 'History',
    test: (value) => /history|war\b|politic/i.test(value || ''),
  },
  {
    label: 'Science',
    test: (value) =>
      /science|chemistry|physics|math|mathematics|computer|programming|technology|medicine|medical|biology|economics/i
        .test(value || ''),
  },
  {
    label: 'Literature',
    test: (value) => /literature|classic|manuscript|ebook|\bbook\b|\bbooks\b|writing/i.test(value || ''),
  },
  {
    label: 'Young Adult',
    test: (value) => /young adult|juvenile|children'?s book|children'?s stories|middle school/i.test(value || ''),
  },
  {
    label: 'Fantasy',
    test: (value) => /fantasy|magic|dragon/i.test(value || ''),
  },
  {
    label: 'Romance',
    test: (value) => /romance|\blove\b|man-woman relationships/i.test(value || ''),
  },
  {
    label: 'Mystery',
    test: (value) => /mystery|detective|spy stories|kidnapping/i.test(value || ''),
  },
  {
    label: 'Thriller',
    test: (value) => /thriller|suspense/i.test(value || ''),
  },
  {
    label: 'Poetry',
    test: (value) => /poetry|\bpoem\b|\bpoems\b/i.test(value || ''),
  },
  {
    label: 'Horror',
    test: (value) => /horror|ghost stories|paranormal/i.test(value || ''),
  },
];

function normalizeBookGenreFacet(value) {
  const normalized = compactWhitespace(value);
  if (!normalized) return null;

  for (const bucket of BOOK_GENRE_BUCKETS) {
    if (bucket.test(normalized)) {
      return bucket.label;
    }
  }

  return 'General Interest';
}

function buildBookGenreFacets(genres) {
  return [...new Set((genres || []).map((genre) => normalizeBookGenreFacet(genre)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function matchesBookGenreFacet(value, selectedGenre) {
  const normalizedSelectedGenre = normalizeBookGenreFacet(selectedGenre);
  if (!normalizedSelectedGenre) {
    return true;
  }

  return normalizeBookGenreFacet(value) === normalizedSelectedGenre;
}

module.exports = {
  buildBookGenreFacets,
  isFictionGenre,
  isNonFictionGenre,
  matchesBookGenreFacet,
  normalizeBookGenreFacet,
};
