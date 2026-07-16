// Unified manga API — routes to the right backend based on source key.
// All three sources go through our server proxy first. MangaDex's API only
// sets Access-Control-Allow-Origin for a small allowlist that happens to
// include localhost (confirmed by inspecting its real response headers) —
// so a direct browser call works in local dev and then silently breaks in
// production ("NetworkError when attempting to fetch resource", a raw CORS
// rejection, not an app-level error). The server-side proxy in
// server/routes/manga.js isn't subject to browser CORS at all, so route
// through it first; fall back to the direct client call only as a last
// resort (e.g. if the Express backend is ever unavailable).
// WeebCentral and Bato.to only ever worked via the server proxy anyway
// (their sites don't set CORS headers for third-party origins at all).

import { searchManga as mdxSearch, getPopular as mdxPopular, getMangaChapters as mdxChapters, getChapterPages as mdxPages } from './mangadexApi';

export const SOURCES = [
  { key: 'mangadex',    label: 'MangaDex',    color: '#c7c7c7' },
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
    case 'mangadex': {
      try {
        const d = await serverGet(`/api/manga/search?q=${encodeURIComponent(query)}`, signal);
        return d.results || [];
      } catch {
        return mdxSearch(query, signal);
      }
    }
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
    case 'mangadex': {
      try {
        const d = await serverGet('/api/manga/popular', signal);
        return d.results || [];
      } catch {
        return mdxPopular(signal);
      }
    }
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
    case 'mangadex': {
      try {
        const d = await serverGet(`/api/manga/${encodeURIComponent(mangaId)}/chapters`, signal);
        return d.chapters || [];
      } catch {
        return mdxChapters(mangaId, signal);
      }
    }
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
    case 'mangadex': {
      try {
        const d = await serverGet(`/api/manga/chapter/${encodeURIComponent(chapterId)}/pages`, signal);
        return { pages: d.pages || [], dataSaverPages: d.dataSaverPages || [] };
      } catch {
        return mdxPages(chapterId, signal);
      }
    }
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
