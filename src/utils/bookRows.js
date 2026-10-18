// Row sources for the Books landing page. The books table (Goodreads
// import) has no popularity column, so "Trending" comes from Open Library's
// weekly trending list matched back to catalog rows; genre rows are random
// windows within a genre (sampleSupabaseCatalogForRecommendations).
import { supabase, isSupabaseConfigured } from './supabase';
import { sampleSupabaseCatalogForRecommendations } from './supabaseMovieCatalog';
import { identityKey } from './mediaIdentity';

const CACHE_TTL_MS = 60 * 60 * 1000;
const BOOK_COLUMNS = 'id, title, author, year, genre, synopsis, cover_url, item_url, source_key';

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function surname(name) {
  const parts = normalize(name).split(' ').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function asBook(row) {
  return { ...row, media_type: 'book' };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = identityKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readCache(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Date.now() - parsed.ts < CACHE_TTL_MS ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* ignore */ }
}

// Open Library trending works -> catalog rows. A match needs the catalog
// title to start with the trending title AND the author's surname to agree
// (prefix alone matched "Pride and Prejudice and Zombies").
export async function fetchTrendingBooks(limit = 24) {
  const cacheKey = 'binge:books:trending';
  const cached = readCache(cacheKey);
  if (cached) return cached;
  if (!isSupabaseConfigured || !supabase) return [];

  let works = [];
  try {
    const response = await fetch('https://openlibrary.org/trending/weekly.json?limit=60');
    if (response.ok) works = (await response.json()).works || [];
  } catch {
    return [];
  }

  const wanted = works
    .filter((work) => work.title && /^[\x20-\x7E’'éèàçüöäñ]+$/.test(work.title))
    .map((work) => ({ title: work.title.replace(/[,()%*]/g, ' ').replace(/\s+/g, ' ').trim(), author: (work.author_name || [])[0] || '' }));
  if (!wanted.length) return [];

  const filter = wanted.map((work) => `title.ilike.${work.title}*`).join(',');
  const { data, error } = await supabase.from('books').select(BOOK_COLUMNS).or(filter).not('cover_url', 'is', null).limit(200);
  if (error || !data) return [];

  const matched = [];
  wanted.forEach((work) => {
    const titleKey = normalize(work.title);
    const authorKey = surname(work.author);
    const candidates = data
      .filter((row) => normalize(row.title).startsWith(titleKey) && (!authorKey || normalize(row.author).includes(authorKey)))
      // Prefer the plain edition over boxed sets / "and Zombies" spin-offs.
      .sort((a, b) => a.title.length - b.title.length);
    if (candidates[0]) matched.push(asBook(candidates[0]));
  });

  const result = dedupe(matched).slice(0, limit);
  writeCache(cacheKey, result);
  return result;
}

export async function fetchBookGenreRow(genre, limit = 30) {
  const rows = await sampleSupabaseCatalogForRecommendations('book', { genre, limit: limit + 10 });
  return dedupe(rows.filter((row) => row.cover_url).map(asBook)).slice(0, limit);
}

export const BOOK_GENRE_ROWS = [
  { id: 'fantasy', title: 'Epic Fantasy', genre: 'Fantasy' },
  { id: 'romance', title: 'Romance', genre: 'Romance' },
  { id: 'thriller', title: 'Mysteries & Thrillers', genre: 'Mystery' },
  { id: 'scifi', title: 'Science Fiction', genre: 'Science Fiction' },
  { id: 'ya', title: 'Young Adult', genre: 'Young Adult' },
  { id: 'historical', title: 'Historical Fiction', genre: 'Historical Fiction' },
  { id: 'horror', title: 'Horror', genre: 'Horror' },
  { id: 'biography', title: 'Biographies & Memoirs', genre: 'Biography' },
  { id: 'nonfiction', title: 'Big Ideas: Non-Fiction', genre: 'Non-Fiction' },
  { id: 'selfhelp', title: 'Self Help', genre: 'Self Help' },
  { id: 'poetry', title: 'Poetry', genre: 'Poetry' },
];
