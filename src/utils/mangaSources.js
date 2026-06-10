// Unified manga API — routes to the right backend based on source key.
// MangaDex calls go directly to api.mangadex.org (CORS-enabled, no server hop).
// WeebCentral and Bato.to go through our server proxy.

import { searchManga as mdxSearch, getPopular as mdxPopular, getMangaChapters as mdxChapters, getChapterPages as mdxPages } from './mangadexApi';

export const SOURCES = [
  { key: 'mangadex',    label: 'MangaDex',    color: '#e8c97a' },
  { key: 'weebcentral', label: 'WeebCentral', color: '#7ab4e8' },
  { key: 'bato',        label: 'Bato.to',     color: '#e87a9b' },
];

async function serverGet(path, signal) {
  const res = await fetch(path, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || `Source error (${res.status})`), { status: res.status });
  }
  return res.json();
}

// ── Search ─────────────────────────────────────────────────────
export async function searchBySource(source, query, signal) {
  if (!query?.trim()) return [];
  switch (source) {
    case 'mangadex':    return mdxSearch(query, signal);
    case 'weebcentral': {
      const d = await serverGet(`/api/weebcentral/search?q=${encodeURIComponent(query)}`, signal);
      return d.results || [];
    }
    case 'bato': {
      const d = await serverGet(`/api/bato/search?q=${encodeURIComponent(query)}`, signal);
      return d.results || [];
    }
    default: return [];
  }
}

// ── Popular ────────────────────────────────────────────────────
export async function popularBySource(source, signal) {
  switch (source) {
    case 'mangadex':    return mdxPopular(signal);
    case 'weebcentral': {
      const d = await serverGet('/api/weebcentral/popular', signal);
      return d.results || [];
    }
    case 'bato': {
      const d = await serverGet('/api/bato/popular', signal);
      return d.results || [];
    }
    default: return [];
  }
}

// ── Chapter list ───────────────────────────────────────────────
export async function chaptersBySource(source, mangaId, signal) {
  switch (source) {
    case 'mangadex':    return mdxChapters(mangaId, signal);
    case 'weebcentral': {
      const d = await serverGet(`/api/weebcentral/${encodeURIComponent(mangaId)}/chapters`, signal);
      return d.chapters || [];
    }
    case 'bato': {
      const d = await serverGet(`/api/bato/${encodeURIComponent(mangaId)}/chapters`, signal);
      return d.chapters || [];
    }
    default: return [];
  }
}

// ── Chapter pages ──────────────────────────────────────────────
export async function pagesBySource(source, chapterId, signal) {
  switch (source) {
    case 'mangadex':    return mdxPages(chapterId, signal);
    case 'weebcentral': {
      const d = await serverGet(`/api/weebcentral/chapter/${encodeURIComponent(chapterId)}/pages`, signal);
      return { pages: d.pages || [], dataSaverPages: [] };
    }
    case 'bato': {
      const d = await serverGet(`/api/bato/chapter/${encodeURIComponent(chapterId)}/pages`, signal);
      return { pages: d.pages || [], dataSaverPages: [] };
    }
    default: return { pages: [], dataSaverPages: [] };
  }
}
