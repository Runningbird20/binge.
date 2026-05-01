const PROXY = '/api/manga';

async function proxyGet(path, signal) {
  const res = await fetch(`${PROXY}${path}`, { signal });
  if (!res.ok) {
    const err = new Error(`MangaDex error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Server returned HTML (dev proxy missing) or other non-JSON response
    console.error('Non-JSON response from', path, text.slice(0, 200));
    throw new Error('Server returned an unexpected response. Make sure the backend is running.');
  }
}

// Returns [{ id, title, cover, author, status, year, tags, latestChapter, description, contentRating }]
export async function searchManga(query, signal) {
  if (!query?.trim()) return [];
  const data = await proxyGet(`/search?q=${encodeURIComponent(query.trim())}`, signal);
  return data?.results || [];
}

// Returns the same shape as searchManga — sorted by popularity
export async function getPopular(signal) {
  const data = await proxyGet('/popular', signal);
  return data?.results || [];
}

// Returns [{ id, number, title, volume, pages, publishAt, group, lang }]
export async function getMangaChapters(mangaId, signal) {
  const data = await proxyGet(`/${mangaId}/chapters`, signal);
  return data?.chapters || [];
}

// Returns { pages: [url, ...], dataSaverPages: [url, ...] }
export async function getChapterPages(chapterId, signal) {
  const data = await proxyGet(`/chapter/${chapterId}/pages`, signal);
  return {
    pages:          data?.pages          || [],
    dataSaverPages: data?.dataSaverPages || [],
  };
}
