// Collections: ready-made sets to scroll through instead of searching
// (Marvel Studios, Christmas, Malayalam classics, All-time top 100…).
//
// The list is public/collections.json (written by scripts/generate-collections.js),
// read by the website and the Apple TV app alike, so a new set needs no app
// update. Each set is live TMDB queries, never a stored list, so it fills
// in new releases by itself:
//   discover   /discover/{movie|tv} with params; "{today+30}" tokens are
//              filled with the viewer's local date when it loads
//   list       a TMDB list path (/trending/movie/week)
//   collection TMDB collections (a franchise), all parts at once
//   titles     particular TMDB ids
//   person     a person's credits for one job (a director's films)
// Results are matched to the catalog like every browse row
// (resolveTmdbItems: release window, the profile's maturity level).
import { tmdbGet, normalizeTmdbResult } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';
import { localIsoDate } from './releaseWindow';

const KIND = { movie: 'movie', tv: 'tv_show' };

let listPromise = null;
export function loadCollections({ fetcher = (url) => fetch(url) } = {}) {
  if (!listPromise) {
    listPromise = fetcher('/collections.json')
      .then((response) => { if (!response.ok) throw new Error(`collections ${response.status}`); return response.json(); })
      .catch((error) => { listPromise = null; throw error; });
  }
  return listPromise;
}

// Sets a profile may see: mature ones are left out on restricted levels.
export function visibleCollections(data, { kidsSafe = false } = {}) {
  const collections = (data?.collections || []).filter((c) => !(kidsSafe && c.mature));
  const groups = (data?.groups || [])
    .map((group) => ({ ...group, collections: collections.filter((c) => c.group === group.id) }))
    .filter((group) => group.collections.length);
  return { groups, collections };
}

// "{today}", "{today+30}", "{today-365}" → a local YYYY-MM-DD.
export function fillParams(params = {}, today = new Date()) {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value).replace(/\{today([+-]\d+)?\}/g, (_, offset) => {
    const date = new Date(today);
    date.setDate(date.getDate() + (Number(offset) || 0));
    return localIsoDate(date);
  })]));
}

const byRelease = (a, b) => String(a.releaseDate || '9999').localeCompare(String(b.releaseDate || '9999'));

// One source's next batch of normalized TMDB results, and whether it has more.
async function readSource(source, page, get) {
  const kind = KIND[source.media] || 'movie';
  if (source.type === 'discover' || source.type === 'list') {
    const path = source.type === 'discover' ? `/discover/${source.media}` : source.path;
    const params = source.type === 'discover'
      ? { include_adult: 'false', sort_by: 'popularity.desc', ...fillParams(source.params), page: String(page) }
      : { page: String(page) };
    const data = await get(path, params);
    const results = (data?.results || []).filter((r) => !r.adult).map((r) => normalizeTmdbResult(r, kind));
    return { results, more: Boolean(data) && page < Math.min(data.total_pages || 1, 500) };
  }
  if (source.type === 'collection') {
    const parts = await Promise.all((source.ids || []).map((id) => get(`/collection/${id}`, {})));
    const results = parts.flatMap((data) => data?.parts || []).map((r) => normalizeTmdbResult(r, kind)).sort(byRelease);
    return { results, more: false };
  }
  if (source.type === 'titles') {
    const found = await Promise.all((source.ids || []).map((id) => get(`/${source.media}/${id}`, {})));
    return { results: found.filter((r) => r?.id).map((r) => normalizeTmdbResult(r, kind)), more: false };
  }
  if (source.type === 'person') {
    const data = await get(`/person/${source.id}/${source.media === 'tv' ? 'tv' : 'movie'}_credits`, {});
    const results = (data?.crew || [])
      .filter((c) => c.job === source.job && (c.vote_count || 0) >= (source.minVotes || 0))
      .map((r) => normalizeTmdbResult(r, kind))
      .sort(byRelease);
    return { results, more: false };
  }
  return { results: [], more: false };
}

// A set as a feed: next() gives the next titles on binge., in the set's
// order, until done. A batch that matched nothing reads on (up to 4 pages)
// so a scroll never stalls on a page of titles the catalog doesn't have.
export function createCollectionFeed(collection, { kidsSafe = false, get = tmdbGet, resolve = resolveTmdbItems } = {}) {
  const sources = (collection.sources || []).map((source) => ({ source, page: 1, more: true }));
  const seen = new Set();
  const limit = collection.limit || Infinity;
  let count = 0;
  let done = !sources.length;

  async function batch() {
    const live = sources.filter((s) => s.more);
    const read = await Promise.all(live.map(async (s) => {
      const { results, more } = await readSource(s.source, s.page, get);
      s.page += 1;
      s.more = more;
      return results;
    }));
    let results = read.flat().filter((r) => !seen.has(`${r.mediaType}:${r.tmdbId}`));
    if (collection.order === 'release') results = results.sort(byRelease);
    // Matched per media type, then put back in the set's order.
    const kinds = [...new Set(results.map((r) => r.mediaType))];
    const resolved = await Promise.all(kinds.map((kind) => resolve(results.filter((r) => r.mediaType === kind), kind, { kidsSafe })));
    const byKey = new Map(resolved.flat().map((item) => [`${item.media_type}:${item._tmdb?.tmdbId}`, item]));
    const items = [];
    for (const r of results) {
      const key = `${r.mediaType}:${r.tmdbId}`;
      seen.add(key);
      const item = byKey.get(key);
      if (item && count < limit) { items.push(item); count += 1; }
    }
    done = count >= limit || sources.every((s) => !s.more);
    return items;
  }

  return {
    get done() { return done; },
    async next() {
      let items = [];
      for (let tries = 0; !done && !items.length && tries < 4; tries += 1) items = await batch();
      return items;
    },
  };
}

// Feeds kept for this tab, so going back to a set (or from its card to it)
// shows what was already loaded at once.
const feeds = new Map();
export function sharedFeed(collection, { kidsSafe = false } = {}) {
  const key = `${collection.id}|${kidsSafe || ''}`;
  if (!feeds.has(key)) feeds.set(key, { feed: createCollectionFeed(collection, { kidsSafe }), items: [], pending: null });
  const entry = feeds.get(key);
  return {
    items: () => entry.items,
    done: () => entry.feed.done,
    // One load at a time; callers share it.
    more() {
      if (!entry.pending) {
        entry.pending = entry.feed.next()
          .then((items) => { entry.items = [...entry.items, ...items]; return entry.items; })
          .catch((error) => { feeds.delete(key); throw error; })
          .finally(() => { entry.pending = null; });
      }
      return entry.pending;
    },
  };
}
