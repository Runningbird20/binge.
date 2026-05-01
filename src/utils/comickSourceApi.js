// Wrapper around the comick-source-api (github.com/GooglyBlox/comick-source-api)
// Live deployment: https://comick-source-api.notaspider.dev
// All calls go through our server proxy first to avoid CORS issues.

const PROXY = '/api/manga';

async function proxyPost(path, body, signal) {
  // 1. Try server proxy
  try {
    const res = await fetch(`${PROXY}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) return res.json();
  } catch { /* fall through */ }

  // 2. Direct fallback
  const res = await fetch(`https://comick-source-api.notaspider.dev${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function proxyGet(path, signal) {
  try {
    const res = await fetch(`${PROXY}${path}`, { signal });
    if (res.ok) return res.json();
  } catch { /* fall through */ }

  const res = await fetch(`https://comick-source-api.notaspider.dev${path}`, { signal });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// Curated fallback shown if the API is unreachable
const FALLBACK_SOURCES = [
  { id: 'mangakatana', name: 'MangaKatana' },
  { id: 'weebcentral', name: 'WeebCentral' },
  { id: 'asurascan',   name: 'AsuraScan'   },
  { id: 'flamecomics', name: 'FlameComics' },
  { id: 'webtoon',     name: 'WEBTOON'     },
  { id: 'mangapark',   name: 'MangaPark'   },
  { id: 'bato',        name: 'Bato'        },
];

export async function getSources(signal) {
  try {
    const data = await proxyGet('/api/sources', signal);
    // API returns { sources: [...] } — not a plain array
    const list = Array.isArray(data) ? data : (data?.sources || []);
    return list.length ? list : FALLBACK_SOURCES;
  } catch {
    return FALLBACK_SOURCES;
  }
}

// Returns SearchResult[]: { id, title, url, coverImage?, latestChapter, lastUpdated, rating?, followers? }
export async function searchComics({ query, source }, signal) {
  if (!query?.trim()) return [];
  const data = await proxyPost('/api/search', { query: query.trim(), source }, signal);
  return data?.results || [];
}

// Returns ScrapedChapter[]: { id, number, title?, url, lastUpdated?, group? }
export async function getChapters({ url, source }, signal) {
  const data = await proxyPost('/api/chapters', { url, source }, signal);
  return data?.chapters || [];
}
