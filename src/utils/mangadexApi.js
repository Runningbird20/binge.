const BASE = 'https://api.mangadex.org';
const CDN  = 'https://uploads.mangadex.org';

function appendAll(params, key, values) {
  for (const v of values) params.append(key, v);
}

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
  const rel = (relationships || []).find(r => r.type === 'cover_art');
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

export async function searchManga({ query = '', format = 'all', page = 1, pageSize = 24, signal } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(pageSize));
  params.set('offset', String((page - 1) * pageSize));
  appendAll(params, 'includes[]', ['cover_art', 'author']);
  appendAll(params, 'contentRating[]', ['safe', 'suggestive']);
  params.set('order[followedCount]', 'desc');
  params.set('hasAvailableChapters', 'true');
  appendAll(params, 'availableTranslatedLanguage[]', ['en']);

  if (query.trim()) params.set('title', query.trim());

  const langs = FORMAT_LANGUAGES[format];
  if (langs) appendAll(params, 'originalLanguage[]', langs);

  const res = await fetch(`${BASE}/manga?${params}`, { signal });
  if (!res.ok) throw new Error(`MangaDex ${res.status}`);
  return res.json(); // { data, total, limit, offset }
}

export async function getMangaChapters(mangaId, signal) {
  const params = new URLSearchParams();
  appendAll(params, 'translatedLanguage[]', ['en']);
  params.set('order[chapter]', 'asc');
  params.set('limit', '500');
  appendAll(params, 'includes[]', ['scanlation_group']);
  params.set('contentRating[]', 'safe');
  params.append('contentRating[]', 'suggestive');

  const res = await fetch(`${BASE}/manga/${mangaId}/feed?${params}`, { signal });
  if (!res.ok) throw new Error(`MangaDex chapters ${res.status}`);
  const json = await res.json();

  // Deduplicate by chapter number — keep first occurrence (best scanlation)
  const seen = new Set();
  const chapters = [];
  for (const ch of (json.data || [])) {
    const num = ch.attributes?.chapter ?? 'oneshot';
    if (!seen.has(num)) { seen.add(num); chapters.push(ch); }
  }
  return chapters;
}

export async function getChapterPages(chapterId, signal) {
  const res = await fetch(`${BASE}/at-home/server/${chapterId}`, { signal });
  if (!res.ok) throw new Error(`MangaDex pages ${res.status}`);
  const { baseUrl, chapter } = await res.json();
  return (chapter.data || []).map(f => `${baseUrl}/data/${chapter.hash}/${f}`);
}
