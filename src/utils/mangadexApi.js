const CDN = 'https://uploads.mangadex.org';

export const FORMAT_LANGUAGES = {
  manga:   ['ja'],
  manhwa:  ['ko'],
  manhua:  ['zh', 'zh-hk'],
  comics:  ['en'],
};

export const FORMAT_LABELS = {
  all:    'All',
  manga:  'Manga',
  manhwa: 'Manhwa',
  manhua: 'Manhua',
  comics: 'Comics',
};

export function getMangaCover(mangaId, relationships) {
  const rel  = (relationships || []).find(r => r.type === 'cover_art');
  const file = rel?.attributes?.fileName;
  return file ? `${CDN}/covers/${mangaId}/${file}.256.jpg` : null;
}

export function getMangaTitle(manga) {
  const t = manga.attributes?.title || {};
  return t.en || Object.values(t)[0] || 'Unknown Title';
}

export function getMangaDescription(manga) {
  const d = manga.attributes?.description || {};
  return d.en || Object.values(d)[0] || '';
}

export function getMangaAuthor(manga) {
  const rel = (manga.relationships || []).find(r => r.type === 'author');
  return rel?.attributes?.name || '';
}

export function getMangaFormat(manga) {
  const lang = manga.attributes?.originalLanguage;
  if (lang === 'ko') return 'manhwa';
  if (lang === 'zh' || lang === 'zh-hk') return 'manhua';
  if (lang === 'en') return 'comics';
  return 'manga';
}

// ── internal helpers ──────────────────────────────────────────

function appendAll(params, key, values) {
  for (const v of values) params.append(key, v);
}

async function apiFetch(serverPath, directUrl, signal) {
  // Try server proxy first (avoids CORS/CSP issues on deployed builds)
  try {
    const res = await fetch(serverPath, { signal });
    if (res.ok) return res.json();
  } catch { /* fall through */ }

  // Direct MangaDex fallback (works locally / if proxy unavailable)
  const res = await fetch(directUrl, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`MangaDex ${res.status}`);
  return res.json();
}

// ── public API ────────────────────────────────────────────────

export async function searchManga({ query = '', format = 'all', page = 1, pageSize = 24, signal } = {}) {
  // Server proxy path
  const serverParams = new URLSearchParams({
    title: query,
    format,
    page: String(page),
    pageSize: String(pageSize),
  });

  // Direct MangaDex path (fallback)
  const directParams = new URLSearchParams();
  directParams.set('limit', String(pageSize));
  directParams.set('offset', String((page - 1) * pageSize));
  appendAll(directParams, 'includes[]', ['cover_art', 'author']);
  appendAll(directParams, 'contentRating[]', ['safe', 'suggestive']);
  directParams.set('order[followedCount]', 'desc');
  directParams.set('hasAvailableChapters', 'true');
  directParams.append('availableTranslatedLanguage[]', 'en');
  if (query.trim()) directParams.set('title', query.trim());
  const langs = FORMAT_LANGUAGES[format];
  if (langs) appendAll(directParams, 'originalLanguage[]', langs);

  return apiFetch(
    `/api/manga/search?${serverParams}`,
    `https://api.mangadex.org/manga?${directParams}`,
    signal,
  );
}

export async function getMangaChapters(mangaId, signal) {
  const directParams = new URLSearchParams();
  appendAll(directParams, 'translatedLanguage[]', ['en']);
  directParams.set('order[chapter]', 'asc');
  directParams.set('limit', '500');
  appendAll(directParams, 'includes[]', ['scanlation_group']);
  appendAll(directParams, 'contentRating[]', ['safe', 'suggestive']);

  const json = await apiFetch(
    `/api/manga/chapters/${mangaId}`,
    `https://api.mangadex.org/manga/${mangaId}/feed?${directParams}`,
    signal,
  );

  // Deduplicate by chapter number — keep first occurrence
  const seen = new Set();
  const chapters = [];
  for (const ch of (json.data || [])) {
    const num = ch.attributes?.chapter ?? 'oneshot';
    if (!seen.has(num)) { seen.add(num); chapters.push(ch); }
  }
  return chapters;
}

export async function getChapterPages(chapterId, signal) {
  const json = await apiFetch(
    `/api/manga/pages/${chapterId}`,
    `https://api.mangadex.org/at-home/server/${chapterId}`,
    signal,
  );
  const { baseUrl, chapter } = json;
  return (chapter.data || []).map(f => `${baseUrl}/data/${chapter.hash}/${f}`);
}
