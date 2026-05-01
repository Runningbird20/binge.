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
