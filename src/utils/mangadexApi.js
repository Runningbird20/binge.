const MDX    = 'https://api.mangadex.org';
const COVERS = 'https://uploads.mangadex.org/covers';

async function mdxGet(path, params = {}, signal) {
  const url = new URL(`${MDX}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(item => url.searchParams.append(k, item));
    else url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    const err = new Error(`MangaDex error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function normalizeManga(m) {
  const attrs  = m.attributes || {};
  const title  = attrs.title?.en || Object.values(attrs.title || {})[0] || 'Unknown';
  const desc   = attrs.description?.en || Object.values(attrs.description || {})[0] || '';
  const cover  = (m.relationships || []).find(r => r.type === 'cover_art');
  const author = (m.relationships || []).find(r => r.type === 'author');
  return {
    id:            m.id,
    title,
    description:   desc.replace(/\[\w+\]/g, '').trim().slice(0, 600),
    cover:         cover?.attributes?.fileName
                     ? `${COVERS}/${m.id}/${cover.attributes.fileName}.512.jpg`
                     : null,
    status:        attrs.status,
    year:          attrs.year,
    author:        author?.attributes?.name || '',
    tags:          (attrs.tags || [])
                     .filter(t => t.attributes?.group === 'genre')
                     .map(t => t.attributes.name.en)
                     .slice(0, 5),
    latestChapter: attrs.lastChapter,
    contentRating: attrs.contentRating,
  };
}

function normalizeChapter(c) {
  const attrs = c.attributes || {};
  const group = (c.relationships || []).find(r => r.type === 'scanlation_group');
  return {
    id:         c.id,
    number:     attrs.chapter,
    title:      attrs.title,
    volume:     attrs.volume,
    pages:      attrs.pages,
    publishAt:  attrs.publishAt,
    group:      group?.attributes?.name || '',
    lang:       attrs.translatedLanguage,
    externalUrl: attrs.externalUrl || null,
  };
}

const CONTENT = ['safe', 'suggestive', 'erotica'];

export async function searchManga(query, signal) {
  if (!query?.trim()) return [];
  const data = await mdxGet('/manga', {
    title:                  query.trim(),
    limit:                  40,
    'includes[]':           ['cover_art', 'author'],
    'contentRating[]':      CONTENT,
    'order[relevance]':     'desc',
  }, signal);
  return (data?.data || []).map(normalizeManga);
}

export async function getPopular(signal) {
  const data = await mdxGet('/manga', {
    limit:                            24,
    'includes[]':                     ['cover_art', 'author'],
    'order[followedCount]':           'desc',
    'contentRating[]':                ['safe', 'suggestive'],
    'availableTranslatedLanguage[]':  ['en'],
  }, signal);
  return (data?.data || []).map(normalizeManga);
}

export async function getMangaChapters(mangaId, signal) {
  const data = await mdxGet(`/manga/${mangaId}/feed`, {
    'translatedLanguage[]': ['en'],
    'order[chapter]':       'asc',
    limit:                  500,
    'includes[]':           ['scanlation_group'],
    'contentRating[]':      CONTENT,
  }, signal);
  return (data?.data || []).map(normalizeChapter);
}

export async function getChapterPages(chapterId, signal) {
  const data  = await mdxGet(`/at-home/server/${chapterId}`, {}, signal);
  const { hash, data: files, dataSaver } = data.chapter || {};
  const base  = data.baseUrl;
  return {
    pages:          (files     || []).map(f => `${base}/data/${hash}/${f}`),
    dataSaverPages: (dataSaver || []).map(f => `${base}/data-saver/${hash}/${f}`),
  };
}
