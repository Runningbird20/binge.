function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeYear(value) {
  if (value == null || value === '') return null;

  const match = String(value).match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function fetchJsonLines(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${url}`);
  }

  return parseJsonLines(await response.text());
}

function normalizeMovie(item, index) {
  return {
    ...item,
    id: Number.isFinite(Number(item?.id)) ? Number(item.id) : index + 1,
    year: normalizeYear(item?.year || item?.releaseDate),
    poster_url: normalizeText(item?.poster_url || item?.posterUrl),
    age_rating: normalizeText(item?.age_rating || item?.ageRating),
    cast_members: normalizeText(item?.cast_members || item?.cast),
    overview: normalizeText(item?.overview || item?.synopsis),
    synopsis: normalizeText(item?.synopsis || item?.overview),
  };
}

function normalizeTvShow(item, index) {
  return {
    ...item,
    id: Number.isFinite(Number(item?.id)) ? Number(item.id) : index + 1,
    year: normalizeYear(item?.year || item?.releaseDate),
    poster_url: normalizeText(item?.poster_url || item?.posterUrl),
    age_rating: normalizeText(item?.age_rating || item?.ageRating),
    cast_members: normalizeText(item?.cast_members || item?.cast),
    overview: normalizeText(item?.overview || item?.synopsis),
    synopsis: normalizeText(item?.synopsis || item?.overview),
    seasons: Number.isFinite(Number(item?.seasons)) ? Number(item.seasons) : null,
  };
}

function normalizeBook(item, index) {
  return {
    ...item,
    id: Number.isFinite(Number(item?.id)) ? Number(item.id) : index + 1,
    year: normalizeYear(item?.year),
    cover_url: normalizeText(item?.cover_url || item?.coverUrl),
    synopsis: normalizeText(item?.synopsis || item?.description) || 'No description available yet.',
  };
}

let moviesPromise;
let tvShowsPromise;
let booksPromise;

export async function loadFallbackMovies() {
  if (!moviesPromise) {
    moviesPromise = fetchJsonLines('/catalog/plex_movies.bulk.jsonl')
      .then((items) => items.map((item, index) => normalizeMovie(item, index)));
  }

  return moviesPromise;
}

export async function loadFallbackTvShows() {
  if (!tvShowsPromise) {
    tvShowsPromise = fetchJsonLines('/catalog/plex_tv.bulk.jsonl')
      .then((items) => items.map((item, index) => normalizeTvShow(item, index)));
  }

  return tvShowsPromise;
}

export async function loadFallbackBooks() {
  if (!booksPromise) {
    booksPromise = fetchJsonLines('/catalog/internet_archive_books.bulk.jsonl')
      .then((items) => items.map((item, index) => normalizeBook(item, index)));
  }

  return booksPromise;
}

export function buildMediaGenreFacets(items = []) {
  return Array.from(
    new Set(
      items
        .flatMap((item) => normalizeText(item?.genre).split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

export function sortMediaItems(items, sortOrder) {
  return [...items].sort((left, right) => {
    if (sortOrder === 'relevance') {
      const leftScore = (left.poster_url ? 100 : 0) + (Number(left.year) || 0);
      const rightScore = (right.poster_url ? 100 : 0) + (Number(right.year) || 0);
      return rightScore - leftScore || left.title.localeCompare(right.title);
    }

    if (sortOrder === 'year-desc') {
      if (left.year == null && right.year == null) return left.title.localeCompare(right.title);
      if (left.year == null) return 1;
      if (right.year == null) return -1;
      return right.year - left.year || left.title.localeCompare(right.title);
    }

    if (sortOrder === 'year-asc') {
      if (left.year == null && right.year == null) return left.title.localeCompare(right.title);
      if (left.year == null) return 1;
      if (right.year == null) return -1;
      return left.year - right.year || left.title.localeCompare(right.title);
    }

    if (sortOrder === 'title-desc') {
      return right.title.localeCompare(left.title);
    }

    return left.title.localeCompare(right.title);
  });
}

export function filterMediaItems(items, { search = '', genre = '', sortOrder = 'title-asc' } = {}) {
  const normalizedSearch = normalizeText(search).toLowerCase();
  const filtered = items.filter((item) => {
    const matchesSearch = !normalizedSearch || normalizeText(item?.title).toLowerCase().includes(normalizedSearch);
    const matchesGenre = !genre || normalizeText(item?.genre).toLowerCase().includes(String(genre).toLowerCase());
    return matchesSearch && matchesGenre;
  });

  return sortMediaItems(filtered, sortOrder);
}

export function filterBooksCatalog(
  items,
  {
    search = '',
    genre = '',
    sortOrder = 'title-asc',
    page = 1,
    pageSize = 24,
  } = {}
) {
  const normalizedSearch = normalizeText(search).toLowerCase();
  const normalizedGenre = normalizeText(genre).toLowerCase();

  const filtered = items.filter((book) => {
    const haystacks = [book?.title, book?.author]
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean);

    const matchesSearch = !normalizedSearch || haystacks.some((value) => value.includes(normalizedSearch));
    const matchesGenre = !normalizedGenre || normalizeText(book?.genre).toLowerCase().includes(normalizedGenre);
    return matchesSearch && matchesGenre;
  });

  const sorted = sortMediaItems(filtered, sortOrder);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndex = Math.max(0, (page - 1) * pageSize);

  return {
    items: sorted.slice(startIndex, startIndex + pageSize),
    total,
    totalPages,
  };
}
