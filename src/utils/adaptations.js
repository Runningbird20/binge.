// Book ↔ screen links. TMDB marks adaptations with keyword 818 ("based on
// novel or book", plus a few siblings) and credits the writer as crew with
// job "Novel" / "Book" / "Author". That gives us the author, which is far
// more reliable than titles (Game of Thrones ← "A Game of Thrones", House of
// the Dragon ← "Fire & Blood"); titles are then only used to rank.
import { requireSupabaseClient } from './supabase';
import { searchTmdbMulti, tmdbGet, tmdbKind } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';

const BOOK_KEYWORD_IDS = new Set([818, 246466]);
const SOURCE_JOBS = new Set(['Novel', 'Book', 'Author', 'Original Story', 'Short Story', 'Characters']);
const BOOK_COLUMNS = 'id, title, author, year, genre, cover_url, source_key';

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .trim();
}

// "Dune (Dune, #1)" → { main: "Dune", series: "Dune", number: 1 }
export function splitBookTitle(title) {
  const match = String(title || '').match(/^(.*?)\s*\(([^()#]*?),?\s*#\s*([\d.]+)[^()]*\)\s*$/);
  if (!match) return { main: String(title || '').trim(), series: '', number: null };
  return { main: match[1].trim(), series: match[2].trim(), number: Number(match[3]) };
}

function surname(name) {
  const parts = normalize(name).split(' ').filter((part) => part.length > 1 && !/^(jr|sr|ii|iii)$/.test(part));
  return parts[parts.length - 1] || '';
}

function sameAuthor(a, b) {
  const na = normalize(a).replace(/\s/g, '');
  const nb = normalize(b).replace(/\s/g, '');
  if (!na || !nb) return false;
  if (na === nb) return true;
  // "George R.R. Martin" vs "George R. R. Martin", "J.K. Rowling" vs "J. K. Rowling"
  return surname(a) === surname(b) && normalize(a)[0] === normalize(b)[0];
}

function titleScore(screenTitle, book) {
  const screen = normalize(screenTitle);
  const { main, series, number } = splitBookTitle(book.title);
  const bookMain = normalize(main);
  const bookSeries = normalize(series);
  let score = 0;
  if (bookMain === screen) score = 100;
  else if (bookMain && (screen.includes(bookMain) || bookMain.includes(screen))) score = 70;
  else if (bookSeries && (screen.includes(bookSeries) || bookSeries.includes(screen))) score = 50;
  if (score && number === 1) score += 5;
  return score;
}

// What a movie/show is based on: { author, books: [catalog book rows] } or null.
export async function findSourceBooks({ mediaType, tmdbId, title }) {
  if (!tmdbId) return null;
  const data = await tmdbGet(`/${tmdbKind(mediaType)}/${tmdbId}`, { append_to_response: 'keywords,credits' });
  if (!data) return null;
  const keywords = data.keywords?.keywords || data.keywords?.results || [];
  const writers = (data.credits?.crew || []).filter((person) => SOURCE_JOBS.has(person.job));
  const basedOnBook = keywords.some((keyword) => BOOK_KEYWORD_IDS.has(keyword.id))
    || writers.some((person) => person.job === 'Novel' || person.job === 'Book');
  if (!basedOnBook) return null;
  const author = (writers.find((person) => person.job === 'Novel' || person.job === 'Book') || writers[0])?.name;
  if (!author) return { author: null, books: [] };

  const supabase = requireSupabaseClient();
  const { data: rows } = await supabase
    .from('books')
    .select(BOOK_COLUMNS)
    .ilike('author', `%${surname(author)}%`)
    .limit(300);
  const byAuthor = (rows || []).filter((book) => sameAuthor(book.author, author));

  // Prefer titles that match the adaptation; otherwise the author's series
  // openers. Dedupe editions with the same normalized title.
  const seen = new Set();
  const ranked = byAuthor
    .map((book) => ({ book, score: titleScore(title, book) }))
    .sort((a, b) => b.score - a.score || (splitBookTitle(a.book.title).number === 1 ? -1 : 0) - (splitBookTitle(b.book.title).number === 1 ? -1 : 0))
    .filter(({ book }) => {
      const key = normalize(splitBookTitle(book.title).main);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // An exact title match stands alone (Dune → Dune, not Chapterhouse: Dune).
  const exact = ranked.filter((entry) => entry.score >= 100);
  const matched = exact.length ? exact : ranked.filter((entry) => entry.score > 0);
  return {
    author,
    exact: matched.length > 0,
    books: (matched.length ? matched : ranked).slice(0, matched.length ? 2 : 3).map((entry) => entry.book),
  };
}

// Movies/shows adapted from a book, verified by the credited author.
export async function findAdaptations(book) {
  if (!book?.title || !book.author) return [];
  const { main, series } = splitBookTitle(book.title);
  const queries = [...new Set([main, series].filter(Boolean))];
  const results = (await Promise.all(queries.map((query) => searchTmdbMulti(query).catch(() => null))))
    .flat()
    .filter(Boolean);
  const wanted = [normalize(main), normalize(series)].filter(Boolean);
  const candidates = [];
  const seen = new Set();
  results.forEach((result) => {
    const key = `${result.mediaType}:${result.tmdbId}`;
    const screen = normalize(result.title);
    if (seen.has(key) || !wanted.some((w) => screen.includes(w) || w.includes(screen))) return;
    seen.add(key);
    candidates.push(result);
  });

  const verified = (await Promise.all(candidates.slice(0, 8).map(async (result) => {
    const data = await tmdbGet(`/${tmdbKind(result.mediaType)}/${result.tmdbId}`, { append_to_response: 'credits' }).catch(() => null);
    const credited = (data?.credits?.crew || []).some((person) => SOURCE_JOBS.has(person.job) && sameAuthor(person.name, book.author));
    return credited ? result : null;
  }))).filter(Boolean);

  const [movies, shows] = await Promise.all([
    resolveTmdbItems(verified.filter((r) => r.mediaType === 'movie'), 'movie'),
    resolveTmdbItems(verified.filter((r) => r.mediaType === 'tv_show'), 'tv_show'),
  ]);
  return [...movies, ...shows].sort((a, b) => String(a.release_date || '').localeCompare(String(b.release_date || '')));
}
