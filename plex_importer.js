const fs = require('fs');
const path = require('path');

const fetchFn =
  typeof fetch !== 'undefined'
    ? fetch
    : (() => {
        throw new Error('This script requires Node.js 18+ with built-in fetch support.');
      })();

const PLEX_BASE_URL = 'https://watch.plex.tv';
const MOVIE_DATABASE_PATH = '/movie-database';
const TV_DATABASE_PATH = '/tv-show-database';
const DEFAULT_LIMIT = 20;
const DEFAULT_RETRIES = 4;
const DEFAULT_DELAY_MS = 250;
const DEFAULT_DETAIL_CONCURRENCY = 1;
const DEFAULT_MAX_ITEMS = 100;
const DEFAULT_MOVIE_OUTPUT = path.join(__dirname, 'data', 'plex_movies.json');
const DEFAULT_TV_OUTPUT = path.join(__dirname, 'data', 'plex_tv.json');
const DEFAULT_MOVIE_BULK_OUTPUT = path.join(__dirname, 'data', 'plex_movies.bulk.jsonl');
const DEFAULT_TV_BULK_OUTPUT = path.join(__dirname, 'data', 'plex_tv.bulk.jsonl');
const DEFAULT_MOVIE_CHECKPOINT = path.join(__dirname, 'data', 'plex_movies.bulk.checkpoint.json');
const DEFAULT_TV_CHECKPOINT = path.join(__dirname, 'data', 'plex_tv.bulk.checkpoint.json');
const DEFAULT_MOVIE_PID_FILE = path.join(__dirname, 'data', 'plex_movies.runner.pid');
const DEFAULT_TV_PID_FILE = path.join(__dirname, 'data', 'plex_tv.runner.pid');
const DEFAULT_MOVIE_LOG_FILE = path.join(__dirname, 'data', 'plex_movies.runner.log');
const DEFAULT_TV_LOG_FILE = path.join(__dirname, 'data', 'plex_tv.runner.log');

const WRITER_ROLE_PATTERNS = [
  /\bwriter\b/i,
  /\bscreenplay\b/i,
  /\bstory\b/i,
  /\bteleplay\b/i,
  /\bwritten by\b/i,
  /\bcreator\b/i,
  /\bcreated by\b/i,
];

const DIRECTOR_ROLE_PATTERNS = [/\bdirector\b/i];
const CREATOR_ROLE_PATTERNS = [/\bcreator\b/i, /\bcreated by\b/i, /\bdeveloper\b/i];
const CREW_ROLE_PATTERNS = [
  ...WRITER_ROLE_PATTERNS,
  ...DIRECTOR_ROLE_PATTERNS,
  /\bproducer\b/i,
  /\bexecutive producer\b/i,
  /\bco-producer\b/i,
  /\bassociate producer\b/i,
  /\beditor\b/i,
  /\bcomposer\b/i,
  /\bmusic\b/i,
  /\bcinematographer\b/i,
  /\bcasting\b/i,
  /\bcostume\b/i,
  /\bmakeup\b/i,
  /\bdesign(er)?\b/i,
  /\banimation\b/i,
  /\bvisual effects\b/i,
  /\bstunt\b/i,
  /\bchoreographer\b/i,
  /\bassistant\b/i,
  /\bcoordinator\b/i,
];

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function compactWhitespace(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function uniqueStrings(values) {
  const seen = new Set();
  const results = [];

  for (const value of ensureArray(values)) {
    const normalized = compactWhitespace(value);
    if (!normalized) continue;

    const key = normalized
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.'’"]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(normalized);
  }

  return results;
}

function joinNames(values, limit = null) {
  const names = uniqueStrings(values);
  const selected = limit == null ? names : names.slice(0, limit);
  return selected.length ? selected.join(', ') : null;
}

function normalizeYear(value) {
  if (!value) return null;
  const match = String(value).match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

function getReferenceDay(referenceDate = new Date()) {
  return new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate()
    )
  );
}

function parseReleaseDate(value) {
  const normalized = compactWhitespace(value);
  if (!normalized) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = new Date(`${normalized}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isReleasedPlexMovie(record, referenceDate = new Date()) {
  if (!record || normalizeMediaType(record.mediaType) !== 'movie') {
    return true;
  }

  const releaseDate = parseReleaseDate(record.releaseDate);
  if (releaseDate) {
    return releaseDate.getTime() <= getReferenceDay(referenceDate).getTime();
  }

  const year = normalizeYear(record.year);
  if (year != null) {
    return year <= referenceDate.getUTCFullYear();
  }

  return true;
}

function shouldKeepPlexRecord(record, referenceDate = new Date()) {
  if (!record) return false;
  return isReleasedPlexMovie(record, referenceDate);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMediaType(value) {
  return value === 'tv' ? 'tv' : 'movie';
}

function decodeHtmlEntities(value) {
  if (typeof value !== 'string' || value.length === 0) return value;

  const namedEntities = {
    '&amp;': '&',
    '&apos;': "'",
    '&#39;': "'",
    '&#x27;': "'",
    '&quot;': '"',
    '&lt;': '<',
    '&gt;': '>',
    '&#x2F;': '/',
    '&#47;': '/',
    '&nbsp;': ' ',
  };

  const decoded = value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|apos|quot|lt|gt|nbsp);|&#39;|&#x27;|&#x2F;|&#47;/gi, (entity) => {
      const normalized = entity.toLowerCase();
      const exactMatch = namedEntities[entity] ?? namedEntities[normalized];
      return exactMatch ?? entity;
    });

  if (/[ÃÅÆÐÑ]/.test(decoded)) {
    try {
      return Buffer.from(decoded, 'latin1').toString('utf8');
    } catch {
      return decoded;
    }
  }

  return decoded;
}

function decodeDeep(value) {
  if (typeof value === 'string') {
    return decodeHtmlEntities(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => decodeDeep(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, itemValue]) => [key, decodeDeep(itemValue)])
    );
  }

  return value;
}

function getPlexPathDefaults(mediaType) {
  const normalizedType = normalizeMediaType(mediaType);
  if (normalizedType === 'tv') {
    return {
      output: DEFAULT_TV_OUTPUT,
      bulkOutput: DEFAULT_TV_BULK_OUTPUT,
      checkpoint: DEFAULT_TV_CHECKPOINT,
      pidFile: DEFAULT_TV_PID_FILE,
      logFile: DEFAULT_TV_LOG_FILE,
    };
  }

  return {
    output: DEFAULT_MOVIE_OUTPUT,
    bulkOutput: DEFAULT_MOVIE_BULK_OUTPUT,
    checkpoint: DEFAULT_MOVIE_CHECKPOINT,
    pidFile: DEFAULT_MOVIE_PID_FILE,
    logFile: DEFAULT_MOVIE_LOG_FILE,
  };
}

async function fetchText(url, { retries = DEFAULT_RETRIES } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        const error = new Error(`Plex request failed with HTTP ${response.status}: ${url}`);
        error.status = response.status;
        throw error;
      }

      return response.text();
    } catch (error) {
      lastError = error;
      const shouldRetry =
        attempt < retries &&
        (!error?.status || error.status === 403 || error.status === 429 || error.status >= 500);

      if (!shouldRetry) {
        break;
      }

      await sleep(attempt * 1000);
    }
  }

  throw lastError;
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonLdObjects(html) {
  return [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => safeJsonParse(match[1]))
    .filter(Boolean)
    .map((item) => decodeDeep(item));
}

function flattenStructuredObjects(jsonLdObjects) {
  return jsonLdObjects.flatMap((item) => {
    if (Array.isArray(item?.['@graph'])) return item['@graph'];
    return [item];
  });
}

function pickStructuredMediaObject(jsonLdObjects, mediaType) {
  const expectedType = mediaType === 'tv' ? 'TVSeries' : 'Movie';
  return flattenStructuredObjects(jsonLdObjects).find((item) => item?.['@type'] === expectedType) || null;
}

function pickFaqObject(jsonLdObjects) {
  return jsonLdObjects.find((item) => item?.['@type'] === 'FAQPage') || null;
}

function extractMetaMap(html) {
  const map = new Map();

  for (const match of html.matchAll(/<meta[^>]+(?:property|name)="([^"]+)"[^>]+content="([^"]*)"/gi)) {
    const key = match[1];
    const value = decodeHtmlEntities(match[2]);
    const existing = map.get(key) || [];
    existing.push(value);
    map.set(key, existing);
  }

  return map;
}

function getFirstMeta(metaMap, key) {
  return compactWhitespace((metaMap.get(key) || [])[0]);
}

function getAllMeta(metaMap, key) {
  return uniqueStrings(metaMap.get(key) || []);
}

function slugToDisplayName(value) {
  const normalized = compactWhitespace(value);
  if (!normalized) return null;

  const slug = normalized.split('/').filter(Boolean).pop() || normalized;
  return compactWhitespace(
    decodeHtmlEntities(slug)
      .replace(/-\d+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function extractCanonicalSlug(html, mediaType) {
  const canonicalMatch = html.match(
    new RegExp(`<link rel="canonical" href="https://watch\\.plex\\.tv\\/${mediaType === 'tv' ? 'show' : 'movie'}\\/([^"#?]+)"`, 'i')
  );

  return compactWhitespace(canonicalMatch?.[1]) || null;
}

function extractTitleFromPageTitle(html, mediaType) {
  const pageTitle = compactWhitespace((html.match(/<title>([^<]+)<\/title>/i) || [])[1]);
  if (!pageTitle) return null;

  const suffixPattern =
    mediaType === 'tv'
      ? /\s*\(\d{4}\)\s*TV Show Online - Plex$/i
      : /\s*\(\d{4}\)\s*Full Movie Online - Plex$/i;

  return compactWhitespace(decodeHtmlEntities(pageTitle.replace(/^Where to Watch\s+/i, '').replace(/^Watch\s+/i, '').replace(suffixPattern, '')));
}

function extractFallbackAgeRating(html) {
  const badgeMatch = html.match(/data-testid="metadata-badges"[\s\S]{0,600}?title="([^"]+)"/i);
  return compactWhitespace(decodeHtmlEntities(badgeMatch?.[1])) || null;
}

function extractFallbackReleaseDate(html) {
  const metadataMatch = html.match(
    /data-testid="metadata-line1"[\s\S]{0,800}?>([A-Z][a-z]+ \d{1,2}, \d{4})</i
  );

  if (!metadataMatch?.[1]) {
    return null;
  }

  const parsedDate = new Date(metadataMatch[1]);
  if (Number.isNaN(parsedDate.getTime())) {
    return compactWhitespace(metadataMatch[1]);
  }

  return parsedDate.toISOString().slice(0, 10);
}

function extractAgeRatingFromFaq(faqObject, title) {
  const normalizedTitle = compactWhitespace(title);
  if (!faqObject || !normalizedTitle) return null;

  const ratingQuestion = ensureArray(faqObject.mainEntity).find((entry) =>
    compactWhitespace(entry?.name)?.toLowerCase() === `what is ${normalizedTitle.toLowerCase()} rated?`
  );
  const answer = compactWhitespace(ratingQuestion?.acceptedAnswer?.text);
  const match = answer?.match(/\bis rated ([A-Z0-9-]+)\b/i);
  return match ? compactWhitespace(match[1]) : null;
}

function extractCreditsEntries(html) {
  const entries = [];
  const seen = new Set();

  for (const match of html.matchAll(/aria-label="([^"]+ • [^"]+)"/g)) {
    const label = decodeHtmlEntities(match[1]);
    const separatorIndex = label.indexOf(' • ');
    if (separatorIndex <= 0) continue;

    const name = compactWhitespace(label.slice(0, separatorIndex));
    const role = compactWhitespace(label.slice(separatorIndex + 3));
    if (!name || !role) continue;
    if (name.toLowerCase().startsWith('open user')) continue;
    if (name.toLowerCase().startsWith('back to the details')) continue;

    const key = `${name.toLowerCase()}::${role.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ name, role });
  }

  return entries;
}

function extractReleaseDateFromFaq(faqObject, title) {
  const normalizedTitle = compactWhitespace(title);
  if (!faqObject || !normalizedTitle) return null;

  const releaseQuestion = ensureArray(faqObject.mainEntity).find((entry) =>
    compactWhitespace(entry?.name)?.toLowerCase() ===
    `what was the release date of ${normalizedTitle.toLowerCase()}?`
  );

  const answer = compactWhitespace(releaseQuestion?.acceptedAnswer?.text);
  const match = answer?.match(/\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/);
  if (!match?.[1]) return null;

  const parsedDate = new Date(match[1]);
  if (Number.isNaN(parsedDate.getTime())) {
    return compactWhitespace(match[1]);
  }

  return parsedDate.toISOString().slice(0, 10);
}

function roleMatches(role, patterns) {
  return patterns.some((pattern) => pattern.test(role || ''));
}

function isCrewRole(role) {
  return roleMatches(role, CREW_ROLE_PATTERNS);
}

function pickRoleNames(entries, patterns, limit = null) {
  const names = entries.filter((entry) => roleMatches(entry.role, patterns)).map((entry) => entry.name);
  return limit == null ? uniqueStrings(names) : uniqueStrings(names).slice(0, limit);
}

function pickCastNames(entries, limit = 5) {
  const names = entries.filter((entry) => !isCrewRole(entry.role)).map((entry) => entry.name);
  return uniqueStrings(names).slice(0, limit);
}

function buildPlexUrl(mediaType, slug, suffix = '') {
  const basePath = mediaType === 'tv' ? 'show' : 'movie';
  return `${PLEX_BASE_URL}/${basePath}/${slug}${suffix}`;
}

async function fetchNormalizedPlexRecord(mediaType, slug) {
  const normalizedType = normalizeMediaType(mediaType);
  const detailUrl = buildPlexUrl(normalizedType, slug);
  const creditsUrl = buildPlexUrl(normalizedType, slug, '/credits');
  const detailHtml = await fetchText(detailUrl);
  const metaMap = extractMetaMap(detailHtml);
  const jsonLdObjects = extractJsonLdObjects(detailHtml);
  const structured = pickStructuredMediaObject(jsonLdObjects, normalizedType);
  const faqObject = pickFaqObject(jsonLdObjects);

  let creditsEntries = [];
  try {
    const creditsHtml = await fetchText(creditsUrl);
    creditsEntries = extractCreditsEntries(creditsHtml);
  } catch {
    creditsEntries = [];
  }

  const structuredActors = ensureArray(structured?.actor).map((actor) => actor?.name);
  const cast = joinNames([...pickCastNames(creditsEntries, 5), ...structuredActors], 5);
  const writers = joinNames([
    ...pickRoleNames(creditsEntries, WRITER_ROLE_PATTERNS),
    ...getAllMeta(metaMap, 'video:writer').map((value) => slugToDisplayName(value)),
  ]);
  const directors = joinNames([
    ...pickRoleNames(creditsEntries, DIRECTOR_ROLE_PATTERNS),
    ...getAllMeta(metaMap, 'video:director').map((value) => slugToDisplayName(value)),
    ensureArray(structured?.director).flatMap((entry) => entry?.name || []),
  ]);
  const creators = joinNames([
    ...pickRoleNames(creditsEntries, CREATOR_ROLE_PATTERNS),
    ...pickRoleNames(creditsEntries, WRITER_ROLE_PATTERNS),
  ], 5);
  const genres = uniqueStrings([
    ...ensureArray(structured?.genre),
    ...getAllMeta(metaMap, 'video:tag'),
  ]);
  const title =
    compactWhitespace(structured?.name) ||
    getFirstMeta(metaMap, 'og:title') ||
    extractTitleFromPageTitle(detailHtml, normalizedType) ||
    'Untitled';
  const releaseDate =
    compactWhitespace(structured?.datePublished) ||
    getFirstMeta(metaMap, 'video:release_date') ||
    extractReleaseDateFromFaq(faqObject, title) ||
    extractFallbackReleaseDate(detailHtml);
  const overview =
    compactWhitespace(structured?.description) ||
    getFirstMeta(metaMap, 'og:description') ||
    getFirstMeta(metaMap, 'description') ||
    'No description available yet.';
  const ageRating =
    compactWhitespace(structured?.contentRating) ||
    extractFallbackAgeRating(detailHtml) ||
    extractAgeRatingFromFaq(faqObject, title);
  const canonicalSlug = extractCanonicalSlug(detailHtml, normalizedType) || slug;
  const posterUrl =
    compactWhitespace(structured?.image) ||
    getFirstMeta(metaMap, 'og:image');

  const baseRecord = {
    source: 'plex',
    sourceKey: `plex:${normalizedType}:${canonicalSlug}`,
    mediaType: normalizedType,
    title,
    year: normalizeYear(releaseDate),
    releaseDate,
    genre: genres.join(', ') || null,
    writers,
    cast,
    ageRating,
    overview,
    synopsis: overview,
    posterUrl,
    plexUrl: detailUrl,
  };

  if (normalizedType === 'tv') {
    return {
      ...baseRecord,
      creator: creators || writers || directors,
      seasons: Number.isFinite(Number(structured?.numberOfSeasons))
        ? Number(structured.numberOfSeasons)
        : null,
    };
  }

  return {
    ...baseRecord,
    director: directors,
  };
}

async function tryFetchNormalizedPlexRecord(mediaType, slug) {
  try {
    return await fetchNormalizedPlexRecord(mediaType, slug);
  } catch (error) {
    console.warn(
      `Skipping ${mediaType} "${slug}" after fetch failure: ${error?.message || error}`
    );
    return null;
  }
}

function parseCatalogPageLabels(html, mediaType) {
  const regex =
    mediaType === 'tv'
      ? /href="\/tv-show-database\/([0-9]{4}s)"/g
      : /href="\/movie-database\/(\d{4})"/g;

  const labels = [...html.matchAll(regex)].map((match) => match[1]);
  const uniqueLabels = [...new Set(labels)];

  return uniqueLabels.sort((left, right) => {
    const leftNumber = Number.parseInt(left, 10);
    const rightNumber = Number.parseInt(right, 10);
    return rightNumber - leftNumber;
  });
}

async function fetchCatalogPages(mediaType) {
  const normalizedType = normalizeMediaType(mediaType);
  const databasePath = normalizedType === 'tv' ? TV_DATABASE_PATH : MOVIE_DATABASE_PATH;
  const html = await fetchText(`${PLEX_BASE_URL}${databasePath}`);
  const labels = parseCatalogPageLabels(html, normalizedType);

  return labels.map((label) => ({
    label,
    path: `${databasePath}/${label}`,
  }));
}

function extractCatalogSlugs(html, mediaType) {
  const prefix = mediaType === 'tv' ? 'show' : 'movie';
  const slugs = [...html.matchAll(new RegExp(`href="/${prefix}/([^"?#/]+)"`, 'g'))].map(
    (match) => match[1]
  );
  return [...new Set(slugs)];
}

async function fetchCatalogSlugs(mediaType, catalogPath) {
  const normalizedType = normalizeMediaType(mediaType);
  const html = await fetchText(`${PLEX_BASE_URL}${catalogPath}`);
  return extractCatalogSlugs(html, normalizedType);
}

function writeJsonFile(filePath, payload) {
  const targetPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
  return targetPath;
}

function appendItemsToJsonl(items, outputPath) {
  const targetPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (!Array.isArray(items) || items.length === 0) {
    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, '', 'utf8');
    }
    return targetPath;
  }

  const lines = items.map((item) => JSON.stringify(item)).join('\n');
  fs.appendFileSync(targetPath, `${lines}\n`, 'utf8');
  return targetPath;
}

function writeCheckpoint(checkpointPath, payload) {
  const targetPath = path.resolve(checkpointPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
  return targetPath;
}

function readCheckpoint(checkpointPath) {
  const targetPath = path.resolve(checkpointPath);
  if (!fs.existsSync(targetPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return null;
  }
}

async function collectPlexResults(
  mediaType,
  {
    limit = DEFAULT_LIMIT,
    detailConcurrency = DEFAULT_DETAIL_CONCURRENCY,
    delayMs = DEFAULT_DELAY_MS,
  } = {}
) {
  const normalizedType = normalizeMediaType(mediaType);
  const catalogPages = await fetchCatalogPages(normalizedType);
  const items = [];
  const seen = new Set();

  for (const catalogPage of catalogPages) {
    if (limit != null && items.length >= limit) break;

    const pageSlugs = await fetchCatalogSlugs(normalizedType, catalogPage.path);
    const uniquePageSlugs = pageSlugs.filter((slug) => {
      if (seen.has(slug)) return false;
      seen.add(slug);
      return true;
    });

    for (let index = 0; index < uniquePageSlugs.length; index += detailConcurrency) {
      if (limit != null && items.length >= limit) break;

      const batch = uniquePageSlugs.slice(index, index + detailConcurrency);
      const records = (
        await mapWithConcurrency(batch, detailConcurrency, async (slug) => {
          const record = await tryFetchNormalizedPlexRecord(normalizedType, slug);
          if (delayMs > 0) {
            await sleep(delayMs);
          }
          return record;
        })
      ).filter((record) => shouldKeepPlexRecord(record));

      items.push(...records);
    }

    if (delayMs > 0 && (limit == null || items.length < limit)) {
      await sleep(delayMs);
    }
  }

  return {
    source: 'plex',
    mediaType: normalizedType,
    collectedAt: new Date().toISOString(),
    catalogPageCount: catalogPages.length,
    collected: limit == null ? items.length : Math.min(items.length, limit),
    items: limit == null ? items : items.slice(0, limit),
  };
}

async function collectPlexResultsBulk(
  {
    mediaType,
    output = null,
    checkpoint = null,
    startPage = 1,
    maxPages = Number.POSITIVE_INFINITY,
    maxItems = DEFAULT_MAX_ITEMS,
    limit = null,
    resume = false,
    delayMs = DEFAULT_DELAY_MS,
  } = {}
) {
  const normalizedType = normalizeMediaType(mediaType);
  const defaults = getPlexPathDefaults(normalizedType);
  const outputPath = path.resolve(output || defaults.bulkOutput);
  const checkpointPath = path.resolve(checkpoint || defaults.checkpoint);

  let currentPageNumber = startPage;
  let processedPages = 0;
  let collected = 0;
  let currentItemIndex = 0;

  if (resume) {
    const existingCheckpoint = readCheckpoint(checkpointPath);
    if (existingCheckpoint) {
      currentPageNumber = Number(existingCheckpoint.nextPage) || currentPageNumber;
      processedPages = Number(existingCheckpoint.processedPages) || 0;
      collected = Number(existingCheckpoint.collected) || 0;
      currentItemIndex = Number(existingCheckpoint.currentItemIndex) || 0;
    }
  } else {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
  }

  const catalogPages = await fetchCatalogPages(normalizedType);
  const totalPages = catalogPages.length;
  let pageIndex = Math.max(0, currentPageNumber - 1);
  let pagesProcessedThisRun = 0;
  let itemsProcessedThisRun = 0;

  appendItemsToJsonl([], outputPath);

  while (pageIndex < catalogPages.length) {
    if (pagesProcessedThisRun >= maxPages) break;
    if (maxItems != null && itemsProcessedThisRun >= maxItems) break;
    if (limit != null && collected >= limit) break;

    const catalogPage = catalogPages[pageIndex];
    const slugs = await fetchCatalogSlugs(normalizedType, catalogPage.path);

    while (currentItemIndex < slugs.length) {
      if (maxItems != null && itemsProcessedThisRun >= maxItems) break;
      if (limit != null && collected >= limit) break;

      const slug = slugs[currentItemIndex];
      const record = await tryFetchNormalizedPlexRecord(normalizedType, slug);
      currentItemIndex += 1;

      if (shouldKeepPlexRecord(record)) {
        appendItemsToJsonl([record], outputPath);
        collected += 1;
      }

      itemsProcessedThisRun += 1;

      writeCheckpoint(checkpointPath, {
        source: 'plex',
        mediaType: normalizedType,
        catalogPath: catalogPage.path,
        catalogLabel: catalogPage.label,
        totalPages,
        processedPages,
        collected,
        currentItemIndex,
        currentPageItemCount: slugs.length,
        currentItemSlug: slug,
        nextPage: pageIndex + 1,
        updatedAt: new Date().toISOString(),
      });

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    if (currentItemIndex < slugs.length) {
      break;
    }

    processedPages += 1;
    pagesProcessedThisRun += 1;
    pageIndex += 1;
    currentItemIndex = 0;

    writeCheckpoint(checkpointPath, {
      source: 'plex',
      mediaType: normalizedType,
      catalogPath: catalogPages[pageIndex]?.path || null,
      catalogLabel: catalogPages[pageIndex]?.label || null,
      totalPages,
      processedPages,
      collected,
      currentItemIndex,
      currentPageItemCount: null,
      currentItemSlug: null,
      nextPage: pageIndex + 1,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    source: 'plex',
    mediaType: normalizedType,
    collected,
    processedPages,
    totalPages,
    nextPage: pageIndex + 1,
    currentItemIndex,
    pagesProcessedThisRun,
    itemsProcessedThisRun,
    complete: pageIndex >= totalPages,
    output: outputPath,
    checkpoint: checkpointPath,
  };
}

function parseCliArgs(argv) {
  const options = {
    type: 'both',
    limit: DEFAULT_LIMIT,
    output: null,
    checkpoint: null,
    bulk: false,
    resume: false,
    startPage: 1,
    maxPages: Number.POSITIVE_INFINITY,
    maxItems: DEFAULT_MAX_ITEMS,
    delayMs: DEFAULT_DELAY_MS,
    detailConcurrency: DEFAULT_DETAIL_CONCURRENCY,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--type':
        options.type = argv[index + 1] || options.type;
        index += 1;
        break;
      case '--limit':
        options.limit = Number(argv[index + 1]) || options.limit;
        index += 1;
        break;
      case '--output':
        options.output = argv[index + 1] || null;
        index += 1;
        break;
      case '--checkpoint':
        options.checkpoint = argv[index + 1] || null;
        index += 1;
        break;
      case '--all':
      case '--bulk':
        options.bulk = true;
        if (options.limit === DEFAULT_LIMIT) {
          options.limit = null;
        }
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--start-page':
        options.startPage = Number(argv[index + 1]) || options.startPage;
        index += 1;
        break;
      case '--max-pages':
        options.maxPages = Number(argv[index + 1]) || options.maxPages;
        index += 1;
        break;
      case '--max-items':
        options.maxItems = Number(argv[index + 1]) || options.maxItems;
        index += 1;
        break;
      case '--delay-ms':
        options.delayMs = Number(argv[index + 1]) || options.delayMs;
        index += 1;
        break;
      case '--detail-concurrency':
        options.detailConcurrency = Number(argv[index + 1]) || options.detailConcurrency;
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function printUsage() {
  console.log(`Plex importer

Usage:
  node plex_importer.js --type movie --limit 20
  node plex_importer.js --type tv --limit 10
  node plex_importer.js --type both --all --max-items 100

Options:
  --type <movie|tv|both>     Which Plex catalog to collect (default: both)
  --limit <number>           Maximum titles to collect per type in one-shot mode
  --output <path>            Output path when importing only one type
  --all | --bulk             Stream normalized results to JSONL with a checkpoint file
  --checkpoint <path>        Checkpoint path for bulk mode
  --resume                   Resume bulk mode from the checkpoint file
  --start-page <number>      Starting catalog page number (default: 1)
  --max-pages <number>       Cap how many catalog pages to fully finish in this run
  --max-items <number>       Cap how many titles to process in this run (default: 100)
  --delay-ms <number>        Delay between title fetches (default: 250)
  --detail-concurrency <n>   Parallel detail fetches in one-shot mode (default: 4)

Notes:
  Movies are grouped by year on /movie-database.
  TV shows are grouped by decade on /tv-show-database.
  Bulk mode checkpoints within the current catalog page so interrupted runs can resume cleanly.
`);
}

async function runCli() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const requestedTypes =
    options.type === 'both' ? ['movie', 'tv'] : [normalizeMediaType(options.type)];

  for (const mediaType of requestedTypes) {
    const defaults = getPlexPathDefaults(mediaType);

    if (options.bulk) {
      const result = await collectPlexResultsBulk({
        mediaType,
        output: options.output && requestedTypes.length === 1 ? options.output : defaults.bulkOutput,
        checkpoint:
          options.checkpoint && requestedTypes.length === 1
            ? options.checkpoint
            : defaults.checkpoint,
        startPage: options.startPage,
        maxPages: options.maxPages,
        maxItems: options.maxItems,
        limit: options.limit,
        resume: options.resume,
        delayMs: options.delayMs,
      });

      console.log(
        `[${mediaType}] Processed ${result.itemsProcessedThisRun} title(s) in this run, completed ${result.pagesProcessedThisRun} catalog page(s), next page ${result.nextPage}.`
      );
      console.log(`[${mediaType}] JSONL output: ${result.output}`);
      console.log(`[${mediaType}] Checkpoint: ${result.checkpoint}`);
      continue;
    }

    const payload = await collectPlexResults(mediaType, {
      limit: options.limit,
      detailConcurrency: options.detailConcurrency,
      delayMs: options.delayMs,
    });

    const outputPath =
      options.output && requestedTypes.length === 1 ? options.output : defaults.output;
    const writtenPath = writeJsonFile(outputPath, payload);
    console.log(`Wrote ${payload.collected} ${mediaType} records to ${writtenPath}`);
  }
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  collectPlexResults,
  collectPlexResultsBulk,
  fetchCatalogPages,
  fetchCatalogSlugs,
  fetchNormalizedPlexRecord,
  getPlexPathDefaults,
  isReleasedPlexMovie,
  shouldKeepPlexRecord,
  readCheckpoint,
  writeJsonFile,
};
