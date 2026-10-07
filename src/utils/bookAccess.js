// Finds the best *legal* way to read a catalog book, fast.
//
// The old lookup searched Gutendex first, which took ~28s per query when
// measured — the "loads forever" reader. Open Library's search answers in
// ~0.4s and already knows, per work, whether a free edition exists and
// where: Standard Ebooks, Project Gutenberg, a public-domain Internet
// Archive scan, or a free Internet Archive loan. Books still under
// copyright fall back to a Google Books preview when the publisher allows
// one, and otherwise to "find it at your library".
//
// Result kinds, best first:
//   standard  — Standard Ebooks edition (proxied: their pages forbid framing)
//   gutenberg — Project Gutenberg HTML (proxied for reader styling)
//   archive   — public-domain scan, Internet Archive embed
//   preview   — Google Books embedded preview (full book when ALL_PAGES)
//   borrow    — free Internet Archive loan (opens Open Library; needs an IA login)
//   none      — no free legal copy; library / store links

const CACHE_KEY = 'binge:book-access:v1';
const LOOKUP_TIMEOUT_MS = 5000;

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .split(/[:;(]/)[0] // "Frankenstein; or, The Modern Prometheus" -> "frankenstein"
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function authorLastName(author) {
  const first = String(author || '').split(/,|&|\band\b/i)[0].trim();
  const parts = first.split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
}

function readCache() {
  try { return JSON.parse(window.localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}

function writeCache(key, value) {
  try {
    const cache = readCache();
    cache[key] = { ...value, at: Date.now() };
    const entries = Object.entries(cache).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 500);
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* storage unavailable */ }
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

const OL_FIELDS = 'key,title,author_name,ebook_access,public_scan_b,lending_identifier_s,ia,id_project_gutenberg,id_standard_ebooks';

async function openLibraryLookup(book) {
  const title = normalizeTitle(book.title);
  const params = new URLSearchParams({ title, fields: OL_FIELDS, limit: '5' });
  const lastName = authorLastName(book.author);
  if (lastName) params.set('author', lastName);
  const data = await fetchJson(`https://openlibrary.org/search.json?${params}`);
  // Exact (normalized) title + author surname, so a different book with
  // the same name never gets paired with this one.
  return (data.docs || []).find((doc) => normalizeTitle(doc.title) === title
    && (!lastName || (doc.author_name || []).some((name) => name.toLowerCase().includes(lastName)))) || null;
}

async function googlePreviewLookup(book) {
  const title = normalizeTitle(book.title);
  const lastName = authorLastName(book.author);
  // Server route first: it uses a Google Books API key (anonymous requests
  // share a tiny quota and get 429s) and caches answers for a day.
  try {
    const params = new URLSearchParams({ title, author: lastName });
    const response = await fetch(`/api/books/google/preview?${params}`, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (response.ok) {
      const data = await response.json();
      if (data && 'preview' in data) return data.preview;
    }
  } catch { /* fall back to a direct call */ }
  const q = `intitle:${title}${lastName ? `+inauthor:${lastName}` : ''}`;
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8&printType=books`);
  const match = (data.items || []).find((volume) => {
    const info = volume.volumeInfo || {};
    const access = volume.accessInfo || {};
    return normalizeTitle(info.title) === title
      && access.embeddable
      && (access.viewability === 'PARTIAL' || access.viewability === 'ALL_PAGES');
  });
  if (!match) return null;
  return { id: match.id, full: match.accessInfo.viewability === 'ALL_PAGES' };
}

function libraryLinks(book, olKey) {
  const q = encodeURIComponent([normalizeTitle(book.title), book.author].filter(Boolean).join(' '));
  return {
    library: `https://www.overdrive.com/search?q=${q}`,
    openLibrary: olKey ? `https://openlibrary.org${olKey}` : `https://openlibrary.org/search?q=${q}`,
    worldcat: `https://search.worldcat.org/search?q=${q}`,
  };
}

/**
 * @returns {Promise<{ kind, label, embedUrl?, externalUrl?, sameOrigin?, links }>}
 */
export async function findReadableEdition(book) {
  const cacheKey = `${book.id || ''}|${normalizeTitle(book.title)}|${authorLastName(book.author)}`;
  const cached = readCache()[cacheKey];
  if (cached && Date.now() - cached.at < 7 * 24 * 3600 * 1000) return cached;

  // Direct hints already in the catalog row win without any lookup.
  const gutenbergInUrl = String(book.item_url || '').match(/gutenberg\.org\/(?:ebooks|files)\/(\d+)/);
  if (gutenbergInUrl) {
    const result = { kind: 'gutenberg', label: 'Project Gutenberg', embedUrl: `/api/books/gutenberg/read/${gutenbergInUrl[1]}`, sameOrigin: true, links: libraryLinks(book) };
    writeCache(cacheKey, result);
    return result;
  }

  const [olResult, googleResult] = await Promise.allSettled([openLibraryLookup(book), googlePreviewLookup(book)]);
  const doc = olResult.status === 'fulfilled' ? olResult.value : null;
  const google = googleResult.status === 'fulfilled' ? googleResult.value : null;
  const links = libraryLinks(book, doc?.key);
  let result;

  const standard = doc?.id_standard_ebooks?.[0];
  const gutenberg = doc?.id_project_gutenberg?.[0];
  if (standard && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(standard)) {
    result = { kind: 'standard', label: 'Standard Ebooks', embedUrl: `/api/books/standard/${standard}`, sameOrigin: true, links };
  } else if (gutenberg && /^\d+$/.test(gutenberg)) {
    result = { kind: 'gutenberg', label: 'Project Gutenberg', embedUrl: `/api/books/gutenberg/read/${gutenberg}`, sameOrigin: true, links };
  } else if (doc?.public_scan_b && doc.lending_identifier_s) {
    result = { kind: 'archive', label: 'Internet Archive', embedUrl: `https://archive.org/embed/${encodeURIComponent(doc.lending_identifier_s)}`, links };
  } else if (google) {
    result = {
      kind: 'preview',
      label: google.full ? 'Google Books' : 'Google Books preview',
      full: google.full,
      embedUrl: `https://books.google.com/books?id=${encodeURIComponent(google.id)}&pg=PP1&output=embed`,
      links,
    };
  } else if (doc?.ebook_access === 'borrowable' && doc.key) {
    result = { kind: 'borrow', label: 'Borrow free on Open Library', externalUrl: `https://openlibrary.org${doc.key}`, links };
  } else {
    result = { kind: 'none', label: 'Not free to read', links };
  }

  // Don't cache a "none" produced by a failed lookup (timeouts, rate limits).
  if (result.kind !== 'none' || (olResult.status === 'fulfilled' && googleResult.status === 'fulfilled')) {
    writeCache(cacheKey, result);
  }
  return result;
}

// Small concurrency limiter so a grid of books doesn't fire 60 lookups at
// once (Open Library rate-limits bursts).
const queue = [];
let active = 0;
const MAX_ACTIVE = 3;

function onLookupDone() {
  active -= 1;
  pump();
}

function startLookup({ book, resolve }) {
  active += 1;
  findReadableEdition(book).then(resolve, () => resolve(null)).finally(onLookupDone);
}

function pump() {
  while (active < MAX_ACTIVE && queue.length) startLookup(queue.shift());
}

export function findReadableEditionQueued(book) {
  const cacheKey = `${book.id || ''}|${normalizeTitle(book.title)}|${authorLastName(book.author)}`;
  const cached = readCache()[cacheKey];
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => { queue.push({ book, resolve }); pump(); });
}

export function isFreeToRead(access) {
  return Boolean(access && ['standard', 'gutenberg', 'archive'].includes(access.kind)) || Boolean(access?.full);
}
