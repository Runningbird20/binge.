const PROXY    = '/api/books';
const GUTENDEX = 'https://gutendex.com';
const IA       = 'https://archive.org';

function normalizeGutendexBook(b) {
  return {
    id:            b.id,
    title:         b.title,
    authors:       (b.authors || []).map(a => {
                     const parts = a.name.split(', ');
                     return parts.length === 2 ? `${parts[1]} ${parts[0]}` : a.name;
                   }).join(', '),
    cover:         b.formats?.['image/jpeg'] ?? null,
    downloadCount: b.download_count,
    hasHtml:       !!(b.formats?.['text/html']),
    subjects:      (b.subjects || []).slice(0, 3),
  };
}

function normalizeIADoc(d) {
  return {
    id:       d.identifier,
    title:    d.title || d.identifier,
    authors:  Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
    year:     d.year || '',
    cover:    `${IA}/services/img/${d.identifier}`,
    embedUrl: `${IA}/embed/${d.identifier}`,
  };
}

// ── Gutenberg / Gutendex ──────────────────────────────────────
export async function searchGutenberg(query, page = 1, signal) {
  // Try server proxy first
  try {
    const res = await fetch(
      `${PROXY}/gutenberg/search?q=${encodeURIComponent(query)}&page=${page}`,
      { signal }
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.books) return data;
    }
  } catch { /* fall through */ }

  // Direct Gutendex fallback (CORS-friendly, no preflight)
  const res = await fetch(
    `${GUTENDEX}/books/?search=${encodeURIComponent(query)}&languages=en&page=${page}`,
    { headers: { Accept: 'application/json' }, signal }
  );
  if (!res.ok) throw new Error(`Gutenberg ${res.status}`);
  const data = await res.json();
  return {
    count: data.count,
    next:  !!data.next,
    books: (data.results || []).map(normalizeGutendexBook),
  };
}

export function getGutenbergReaderUrl(id) {
  return `${PROXY}/gutenberg/read/${id}`;
}

// ── Internet Archive ──────────────────────────────────────────
// IA advancedsearch requires literal [] in the URL, not %5B%5D
function iaSearchUrl(query) {
  const q   = encodeURIComponent(`(${query}) AND mediatype:texts AND language:eng`);
  const fl  = ['identifier', 'title', 'creator', 'year', 'subject'].map(f => `fl[]=${f}`).join('&');
  return `${IA}/advancedsearch.php?q=${q}&rows=24&output=json&sort=downloads+desc&${fl}`;
}

export async function searchArchive(query, signal) {
  // Try server proxy first
  try {
    const res = await fetch(
      `${PROXY}/archive/search?q=${encodeURIComponent(query)}`,
      { signal }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
    }
  } catch { /* fall through */ }

  // Direct IA fallback — literal [] required in URL
  const res = await fetch(iaSearchUrl(query), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`Archive ${res.status}`);
  const data = await res.json();
  return (data.response?.docs || []).map(normalizeIADoc);
}

export function annasArchiveUrl(title, authors) {
  const q = [title, authors].filter(Boolean).join(' ');
  return `https://annas-archive.org/search?q=${encodeURIComponent(q)}`;
}

// ── Catalog → free-edition matching ────────────────────────────
// Gutendex/IA search is relevance-ranked, not exact — blindly taking the
// first result risks pairing a catalog book with a same-titled but
// different book (e.g. a different "Emma"). Require the normalized title
// to match exactly, and (when the catalog has an author on file) the
// candidate's author string to contain that author's last name.
function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .split(':')[0] // drop ": A Novel" / subtitle noise
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function authorLastName(author) {
  if (!author) return '';
  const first = String(author).split(/,|&|\band\b/i)[0].trim();
  const parts = first.split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
}

function isConfidentMatch(book, candidateTitle, candidateAuthors) {
  const wantTitle = normalizeTitle(book?.title);
  if (!wantTitle || normalizeTitle(candidateTitle) !== wantTitle) return false;
  const wantLast = authorLastName(book?.author);
  if (!wantLast) return true; // no author on file — exact title is all we can check
  return String(candidateAuthors || '').toLowerCase().includes(wantLast);
}

// Looks up a catalog book (any source — Goodreads/OpenLibrary import, not
// just ones already tagged as Gutenberg/Archive) against both free
// providers and returns a playable match, or null if nothing legally
// readable was found. Gutenberg is tried first (cleaner reader UI, HTML
// proxy already strips IA's borrow/wait-list friction), then Internet
// Archive as a broader fallback.
export async function findFreeEdition(book, signal) {
  if (!book?.title) return null;
  const q = `${book.title}${book.author ? ` ${book.author}` : ''}`.trim();

  try {
    const result = await searchGutenberg(q, 1, signal);
    const match = (result.books || []).find(
      (b) => b.hasHtml && isConfidentMatch(book, b.title, b.authors)
    );
    if (match) {
      return {
        source: 'gutenberg',
        id: match.id,
        embedUrl: getGutenbergReaderUrl(match.id),
        title: match.title,
        authors: match.authors,
      };
    }
  } catch { /* fall through to Internet Archive */ }

  try {
    const docs = await searchArchive(q, signal);
    const match = docs.find((d) => isConfidentMatch(book, d.title, d.authors));
    if (match) {
      return {
        source: 'archive',
        id: match.id,
        embedUrl: match.embedUrl,
        title: match.title,
        authors: match.authors,
      };
    }
  } catch { /* no free edition available */ }

  return null;
}

// ── Catalog-card badge support ─────────────────────────────────
// A catalog grid can render up to a few dozen cards at once (see
// VISIBLE_BATCH_SIZE in Books.js) — firing that many concurrent lookups at
// Gutendex/Internet Archive on every mount would be slow and rude to those
// free services. This caches results for the session (keyed by title+author,
// not id, since the same title can arrive from different catalog sources)
// and caps how many lookups run at once, queuing the rest.
const freeEditionCache = new Map(); // key -> match | null
const freeEditionInflight = new Map(); // key -> Promise
const MAX_CONCURRENT_LOOKUPS = 4;
let activeLookups = 0;
const lookupQueue = [];

function startLookup(job) {
  activeLookups++;
  job().finally(() => {
    activeLookups--;
    runQueuedLookups();
  });
}

function runQueuedLookups() {
  while (activeLookups < MAX_CONCURRENT_LOOKUPS && lookupQueue.length > 0) {
    startLookup(lookupQueue.shift());
  }
}

function enqueueLookup(job) {
  return new Promise((resolve, reject) => {
    lookupQueue.push(() => job().then(resolve, reject));
    runQueuedLookups();
  });
}

function freeEditionCacheKey(book) {
  return `${String(book?.title || '').toLowerCase()}|${String(book?.author || '').toLowerCase()}`;
}

// Same as findFreeEdition, but deduped/cached/concurrency-limited — meant
// for "is this readable?" badges across a whole grid, not a single reader.
export function checkFreeEditionCached(book) {
  const key = freeEditionCacheKey(book);
  if (freeEditionCache.has(key)) return Promise.resolve(freeEditionCache.get(key));
  if (freeEditionInflight.has(key)) return freeEditionInflight.get(key);

  const promise = enqueueLookup(() => findFreeEdition(book))
    .then((match) => { freeEditionCache.set(key, match); return match; })
    .catch(() => { freeEditionCache.set(key, null); return null; })
    .finally(() => freeEditionInflight.delete(key));

  freeEditionInflight.set(key, promise);
  return promise;
}
