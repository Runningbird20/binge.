// Manga & Comics provider registry. Every source implements the same shape,
// so the UI (MangaTab) never special-cases a provider:
//
//   { key, label, tagline, reading: 'in-app' | 'external',
//     rows: [{ id, title, subtitle?, ranked?, load(signal) }],
//     search(query, signal) → manga[],
//     popular(signal) → manga[],
//     getChapters(manga, signal) → chapter[]        (in-app only)
//     getPages(chapter, signal) → { pages, dataSaverPages } (in-app only)
//     readLinks(manga) → [{ site, url, free }] }    (external: official reader)
//
// manga: { id, provider, title, description, cover, status, year, author,
//          tags, latestChapter, contentRating, originalLanguage, anilistId?,
//          readLinks? }
//
// MangaDex reads in binge.'s own reader. WEBTOON and MANGA Plus have no
// public chapter API, so their series come from AniList's official-source
// data and open in the publisher's own reader.
import {
  searchManga as mdxSearch,
  getPopular as mdxPopular,
  getMangaChapters as mdxChapters,
  getChapterPages as mdxPages,
} from './mangadexApi';
import { listOfficial } from './anilist';

async function serverGet(path, signal) {
  const res = await fetch(path, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = res.status === 429
      ? 'MangaDex is rate limiting requests — try again in a minute.'
      : body.error || `Source error (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return res.json();
}

const tagProvider = (key) => (list) => (list || []).map((manga) => ({ provider: key, ...manga }));

// ── MangaDex (in-app reader) ───────────────────────────────────────────
// Server proxy first (MangaDex only sends CORS headers to an allowlist that
// includes localhost, so direct browser calls break in production), direct
// client call as a fallback.

export async function browseMangaDex({ lang = '', tags = [], order = 'popular', limit = 24 } = {}, signal) {
  const params = new URLSearchParams({ order, limit: String(limit) });
  if (lang) params.set('lang', lang);
  if (tags.length) params.set('tags', tags.join(','));
  const d = await serverGet(`/api/manga/browse?${params}`, signal);
  return tagProvider('mangadex')(d.results);
}

const MANGADEX_ROWS = [
  { id: 'popular', title: 'Popular Right Now', query: { order: 'popular' }, ranked: true },
  { id: 'latest', title: 'Fresh Chapters', query: { order: 'latest' } },
  { id: 'manhwa', title: 'Top Manhwa', subtitle: 'Korean webtoons', query: { order: 'popular', lang: 'ko' } },
  { id: 'rated', title: 'Highest Rated', query: { order: 'rating' } },
  { id: 'manga', title: 'Top Manga', subtitle: 'From Japan', query: { order: 'popular', lang: 'ja' } },
  { id: 'manhua', title: 'Top Manhua', subtitle: 'Chinese webcomics', query: { order: 'popular', lang: 'zh' } },
  { id: 'action', title: 'Action & Battles', query: { tags: ['Action'] } },
  { id: 'romance', title: 'Romance', query: { tags: ['Romance'] } },
  { id: 'isekai', title: 'Isekai', query: { tags: ['Isekai'] } },
  { id: 'fantasy', title: 'Fantasy Worlds', query: { tags: ['Fantasy'] } },
  { id: 'comedy', title: 'Comedy', query: { tags: ['Comedy'] } },
  { id: 'slice', title: 'Slice of Life', query: { tags: ['Slice of Life'] } },
  { id: 'horror', title: 'Horror & Thriller', query: { tags: ['Horror'] } },
  { id: 'sports', title: 'Sports', query: { tags: ['Sports'] } },
  { id: 'new', title: 'New on MangaDex', query: { order: 'new' } },
].map((row) => ({ ...row, load: (signal) => browseMangaDex({ ...row.query, limit: row.ranked ? 10 : 24 }, signal) }));

const mangadex = {
  key: 'mangadex',
  label: 'MangaDex',
  tagline: 'Read right here in binge.',
  reading: 'in-app',
  rows: MANGADEX_ROWS,
  async search(query, signal) {
    if (!query?.trim()) return [];
    try {
      const d = await serverGet(`/api/manga/search?q=${encodeURIComponent(query)}`, signal);
      return tagProvider('mangadex')(d.results);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      return tagProvider('mangadex')(await mdxSearch(query, signal));
    }
  },
  async popular(signal) {
    try {
      return await browseMangaDex({ order: 'popular', limit: 24 }, signal);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      try {
        const d = await serverGet('/api/manga/popular', signal);
        return tagProvider('mangadex')(d.results);
      } catch (inner) {
        if (inner.name === 'AbortError') throw inner;
        return tagProvider('mangadex')(await mdxPopular(signal));
      }
    }
  },
  async getChapters(manga, signal) {
    try {
      const d = await serverGet(`/api/manga/${encodeURIComponent(manga.id)}/chapters`, signal);
      return d.chapters || [];
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      return mdxChapters(manga.id, signal);
    }
  },
  async getPages(chapter, signal) {
    try {
      const d = await serverGet(`/api/manga/chapter/${encodeURIComponent(chapter.id)}/pages`, signal);
      return { pages: d.pages || [], dataSaverPages: d.dataSaverPages || [] };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      return mdxPages(chapter.id, signal);
    }
  },
  readLinks: () => [],
};

// ── Official publishers via AniList (external reader) ──────────────────

function officialProvider({ key, label, tagline, siteIds, rowsLabel }) {
  const list = (options, signal) => listOfficial({ siteIds, provider: key, ...options }, signal);
  return {
    key,
    label,
    tagline,
    reading: 'external',
    siteIds,
    rows: [
      { id: 'popular', title: `Popular on ${rowsLabel}`, ranked: true, load: (signal) => list({ sort: ['POPULARITY_DESC'], perPage: 10 }, signal) },
      { id: 'trending', title: 'Trending now', load: (signal) => list({ sort: ['TRENDING_DESC'] }, signal) },
      { id: 'ongoing', title: 'New chapters weekly', subtitle: 'Still releasing', load: (signal) => list({ sort: ['POPULARITY_DESC'], status: 'RELEASING' }, signal) },
      { id: 'top', title: 'Highest rated', load: (signal) => list({ sort: ['SCORE_DESC'] }, signal) },
      { id: 'complete', title: 'Complete series', subtitle: 'Binge from start to finish', load: (signal) => list({ sort: ['SCORE_DESC'], status: 'FINISHED' }, signal) },
    ],
    search: (query, signal) => (query?.trim() ? list({ search: query.trim(), sort: ['SEARCH_MATCH'] }, signal) : Promise.resolve([])),
    popular: (signal) => list({ sort: ['TRENDING_DESC'] }, signal),
    getChapters: null,
    getPages: null,
    // This service's own link first, then any other official ones.
    readLinks: (manga) => [...(manga.readLinks || [])].sort((a, b) => Number(siteIds.includes(b.siteId)) - Number(siteIds.includes(a.siteId))),
  };
}

const webtoon = officialProvider({
  key: 'webtoon',
  label: 'WEBTOON',
  tagline: 'Free official webtoons — opens in WEBTOON',
  siteIds: [43],
  rowsLabel: 'WEBTOON',
});

const mangaplus = officialProvider({
  key: 'mangaplus',
  label: 'MANGA Plus',
  tagline: 'Free Shonen Jump chapters from Shueisha — opens in MANGA Plus',
  siteIds: [42],
  rowsLabel: 'MANGA Plus',
});

export const PROVIDERS = { mangadex, webtoon, mangaplus };
export const PROVIDER_LIST = [mangadex, webtoon, mangaplus];
export const DEFAULT_PROVIDER = 'mangadex';

export function getProvider(key) {
  return PROVIDERS[key] || PROVIDERS[DEFAULT_PROVIDER];
}

// The provider a saved/selected series belongs to (library entries saved
// before providers existed are MangaDex).
export function providerFor(manga) {
  return getProvider(manga?.provider);
}
