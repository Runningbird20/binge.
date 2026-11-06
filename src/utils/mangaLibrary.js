// The Manga & Comics tab's own list and ratings, kept in this browser's localStorage.

const LS_LIST    = 'manga_reading_list';
const LS_RATINGS = 'manga_ratings';

function getLS(key)     { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function setLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// Every saved series, keyed by id.
export function getMangaList()              { return getLS(LS_LIST); }
export function getMangaListItem(id)        { return getLS(LS_LIST)[id]    || null; }
export function getMangaRating(id)          { return getLS(LS_RATINGS)[id] || null; }

export function upsertMangaListItem(manga, status) {
  const list = getLS(LS_LIST);
  list[manga.id] = {
    id: manga.id,
    provider: manga.provider || 'mangadex',
    title: manga.title,
    cover: manga.cover,
    author: manga.author || '',
    anilistId: manga.anilistId || null,
    readLinks: manga.readLinks || null,
    status,
    savedAt: Date.now(),
  };
  setLS(LS_LIST, list);
  return list[manga.id];
}

export function removeMangaListItem(id) { const l = getLS(LS_LIST); delete l[id]; setLS(LS_LIST, l); }
export function saveMangaRating(id, scores) { const r = getLS(LS_RATINGS); r[id] = scores; setLS(LS_RATINGS, r); return scores; }

export const MANGA_STATUSES = [
  { value: 'plan_to_read',  label: 'Plan to Read' },
  { value: 'reading',       label: 'Currently Reading' },
  { value: 'completed',     label: 'Completed' },
  { value: 'on_hold',       label: 'On Hold' },
  { value: 'dropped',       label: 'Dropped' },
];
