// AniList GraphQL (https://docs.anilist.co) — free, no key, CORS-enabled,
// rate limited to ~90 requests/min per IP. Used for official-source
// providers (WEBTOON, MANGA Plus) and "Where to read" links: AniList keeps
// each series' official reading links (externalLinks, type STREAMING) and
// can filter the catalogue by the service that publishes it
// (licensedById_in). Ids below come from ExternalLinkSourceCollection.
const ENDPOINT = 'https://graphql.anilist.co';
const CACHE_MS = 30 * 60 * 1000;

// Official reading services (English editions), by AniList external-link
// source id.
export const READING_SITES = {
  43: { name: 'WEBTOON', free: true },
  42: { name: 'MANGA Plus', free: true },
  75: { name: 'Tapas', free: false },
  77: { name: 'Tappytoon', free: false },
  80: { name: 'Manta', free: false },
  132: { name: 'VIZ', free: false },
  215: { name: 'K MANGA', free: false },
  157: { name: 'Comikey', free: false },
  159: { name: 'INKR', free: false },
  46: { name: 'Lezhin', free: false },
  181: { name: 'Lezhin X', free: false },
};
const READING_SITE_IDS = Object.keys(READING_SITES).map(Number);

const cache = new Map(); // body -> { at, promise }

export class AniListError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Requests are shared through the cache, so the network call itself is never
// tied to one caller's AbortSignal (React's dev double-mount would otherwise
// cancel the shared request for everyone). A caller that aborts just stops
// waiting.
export async function anilistQuery(query, variables = {}, signal) {
  const body = JSON.stringify({ query, variables });
  let hit = cache.get(body);
  if (!hit || Date.now() - hit.at >= CACHE_MS) {
    const promise = (async () => {
      let res;
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
        });
      } catch {
        throw new AniListError('Couldn’t reach AniList. Check your connection and try again.', 0);
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('Retry-After')) || 60;
        throw new AniListError(`AniList is busy — try again in about ${wait} seconds.`, 429);
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.errors) {
        const message = json?.errors?.[0]?.message || `AniList error (${res.status})`;
        throw new AniListError(res.status === 404 ? 'That series wasn’t found.' : message, res.status);
      }
      return json.data;
    })();
    hit = { at: Date.now(), promise };
    cache.set(body, hit);
    promise.catch(() => { if (cache.get(body) === hit) cache.delete(body); }); // don't cache failures
  }
  if (!signal) return hit.promise;
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    hit.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

const MEDIA_FIELDS = `
  id
  title { english romaji native }
  synonyms
  description(asHtml: false)
  coverImage { extraLarge large }
  status
  startDate { year }
  chapters
  genres
  countryOfOrigin
  isAdult
  averageScore
  staff(perPage: 2, sort: [RELEVANCE]) { edges { role node { name { full } } } }
  externalLinks { site siteId url language type }
`;

function cleanDescription(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\(Source:[^)]*\)/gi, '')
    .replace(/&quot;/g, '"').replace(/&#039;/g, '\'').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 600);
}

const ORIGIN = { KR: 'ko', JP: 'ja', CN: 'zh', TW: 'zh' };

// Official reading links, one per service, English edition preferred.
// `onlySiteIds` limits it (e.g. the WEBTOON provider shows WEBTOON first).
export function readLinksOf(media, onlySiteIds = null) {
  const bySite = new Map();
  (media?.externalLinks || []).forEach((link) => {
    if (!READING_SITE_IDS.includes(link.siteId)) return;
    if (onlySiteIds && !onlySiteIds.includes(link.siteId)) return;
    const english = !link.language || link.language === 'English';
    const current = bySite.get(link.siteId);
    if (!current || (english && !current.english)) bySite.set(link.siteId, { ...link, english });
  });
  return [...bySite.values()]
    .filter((link) => /^https?:\/\//.test(link.url))
    .map((link) => ({ site: READING_SITES[link.siteId].name, siteId: link.siteId, url: link.url.replace(/^http:/, 'https:'), free: READING_SITES[link.siteId].free }))
    .sort((a, b) => Number(b.free) - Number(a.free));
}

// AniList media → binge.'s manga shape (same fields the MangaDex provider
// returns, plus readLinks). Ids are namespaced so they never collide with
// MangaDex UUIDs in the library.
export function normalizeAniList(media, provider) {
  const story = (media.staff?.edges || []).find((edge) => /story|original/i.test(edge.role)) || media.staff?.edges?.[0];
  return {
    id: `al:${media.id}`,
    anilistId: media.id,
    provider,
    title: media.title?.english || media.title?.romaji || media.title?.native || 'Untitled',
    description: cleanDescription(media.description),
    cover: media.coverImage?.extraLarge || media.coverImage?.large || null,
    status: media.status ? media.status.toLowerCase().replace(/_/g, ' ') : null,
    year: media.startDate?.year || null,
    author: story?.node?.name?.full || '',
    tags: (media.genres || []).slice(0, 5),
    latestChapter: media.chapters || null,
    contentRating: media.isAdult ? 'erotica' : 'safe',
    originalLanguage: ORIGIN[media.countryOfOrigin] || null,
    readLinks: readLinksOf(media),
  };
}

const LIST_QUERY = `query ($sites: [Int], $search: String, $sort: [MediaSort], $status: MediaStatus, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(type: MANGA, isAdult: false, licensedById_in: $sites, search: $search, sort: $sort, status: $status) { ${MEDIA_FIELDS} }
  }
}`;

// Series published by the given services (search or browse).
export async function listOfficial({ siteIds, search = null, sort = ['POPULARITY_DESC'], status = null, perPage = 24, provider }, signal) {
  const data = await anilistQuery(LIST_QUERY, { sites: siteIds, search: search || undefined, sort, status: status || undefined, page: 1, perPage }, signal);
  return (data?.Page?.media || []).map((media) => normalizeAniList(media, provider));
}

const BY_ID_QUERY = `query ($id: Int) { Media(id: $id, type: MANGA) { ${MEDIA_FIELDS} } }`;
const FIND_QUERY = `query ($search: String) { Page(perPage: 5) { media(type: MANGA, search: $search, sort: [SEARCH_MATCH]) { ${MEDIA_FIELDS} } } }`;

function normalizeTitle(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// "Where to read": the official places a series is published. Uses the
// AniList id when we have it (MangaDex links it), otherwise an exact title
// match — never a fuzzy guess, so we don't send people to the wrong series.
export async function findWhereToRead(item, signal) {
  if (item?.readLinks?.length) return item.readLinks;
  if (item?.anilistId) {
    const data = await anilistQuery(BY_ID_QUERY, { id: Number(item.anilistId) }, signal);
    return readLinksOf(data?.Media);
  }
  if (!item?.title) return [];
  const data = await anilistQuery(FIND_QUERY, { search: item.title }, signal);
  const wanted = normalizeTitle(item.title);
  const match = (data?.Page?.media || []).find((media) => [media.title?.english, media.title?.romaji, ...(media.synonyms || [])]
    .some((title) => normalizeTitle(title) === wanted));
  return match ? readLinksOf(match) : [];
}
