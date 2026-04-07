/**
 * Open Library Scraper
 * ====================
 * Fetches rich book data from https://openlibrary.org/ via the public API.
 *
 * This version keeps the original helper-style entry points but returns much
 * more of the source payloads, including raw API responses when useful.
 *
 * Usage:
 *   node openlibrary_scraper.js
 *
 * Functions exported:
 *   searchBooks(query, options)
 *   searchBooksResponse(query, options)
 *   getBookDetails(olid, options)
 *   getWorkDetails(workId, options)
 *   getAuthorDetails(authorId, options)
 *   getSimilarBooks(workId, limit)
 *   getTrendingBooks(period, limit)
 *   getBooksBySubject(subject, options)
 *   getBookByISBN(isbn, options)
 *   getWorkRatings(workId)
 *   getWorkBookshelves(workId)
 *   getCoverUrl(coverId, size)
 *   getCoverByISBN(isbn, size)
 */

const fetchFn =
  typeof fetch !== "undefined"
    ? fetch
    : (() => {
        try {
          return require("node-fetch");
        } catch {
          throw new Error(
            "Please install node-fetch: npm install node-fetch (or use Node 18+)"
          );
        }
      })();

const BASE = "https://openlibrary.org";
const COVERS_BASE = "https://covers.openlibrary.org";
const DEFAULT_HEADERS = {
  "User-Agent": "MediaHistoryApp/1.0 (contact@yoursite.com)",
  Accept: "application/json",
};

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function normalizeKey(key, prefix) {
  if (!key) return null;
  return String(key).replace(prefix, "").replace(/^\//, "");
}

function toOpenLibraryUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  return String(pathOrUrl).startsWith("http")
    ? String(pathOrUrl)
    : `${BASE}${String(pathOrUrl).startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function normalizeTextValue(value) {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object") {
    if (typeof value.value === "string") return value.value.trim() || null;
    if (typeof value.name === "string") return value.name.trim() || null;
    if (typeof value.title === "string") return value.title.trim() || null;
  }
  return null;
}

function normalizeTimestamp(value) {
  return value?.value || null;
}

function normalizeLanguage(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.key) {
    return normalizeKey(value.key, "/languages/");
  }
  return null;
}

function normalizeLinkRecord(link) {
  if (!link) return null;
  return {
    title: normalizeTextValue(link.title),
    url: link.url || null,
    typeKey: link.type?.key || null,
  };
}

function resolveAuthorName(author) {
  if (!author) return "Unknown";
  if (typeof author === "string") return author;
  return (
    normalizeTextValue(author.name) ||
    normalizeTextValue(author.personal_name) ||
    "Unknown"
  );
}

function getCoverUrl(coverId, size = "M") {
  if (!coverId) return null;
  return `${COVERS_BASE}/b/id/${coverId}-${size}.jpg`;
}

function getCoverByISBN(isbn, size = "M") {
  if (!isbn) return null;
  return `${COVERS_BASE}/b/isbn/${isbn}-${size}.jpg`;
}

function getAuthorPhotoUrl(photoId, size = "M") {
  if (!photoId) return null;
  return `${COVERS_BASE}/a/id/${photoId}-${size}.jpg`;
}

function buildCoverVariants(coverId) {
  if (!coverId) return null;
  return {
    id: coverId,
    small: getCoverUrl(coverId, "S"),
    medium: getCoverUrl(coverId, "M"),
    large: getCoverUrl(coverId, "L"),
  };
}

function buildCoverSet(coverIds) {
  return ensureArray(coverIds).map(buildCoverVariants).filter(Boolean);
}

function buildAuthorPhotoSet(photoIds) {
  return ensureArray(photoIds)
    .map((photoId) => ({
      id: photoId,
      small: getAuthorPhotoUrl(photoId, "S"),
      medium: getAuthorPhotoUrl(photoId, "M"),
      large: getAuthorPhotoUrl(photoId, "L"),
    }))
    .filter(Boolean);
}

function extractIdFields(record) {
  const identifiers = {};

  for (const [key, value] of Object.entries(record || {})) {
    if (
      key === "isbn" ||
      key === "oclc" ||
      key === "lccn" ||
      key === "ia" ||
      key.startsWith("id_")
    ) {
      identifiers[key] = ensureArray(value).filter(Boolean);
    }
  }

  return identifiers;
}

function normalizeAuthorReference(author) {
  const key = author?.key || author?.author?.key || author || null;
  const name =
    normalizeTextValue(author?.name) ||
    normalizeTextValue(author?.author?.name) ||
    null;

  return {
    key,
    authorId: normalizeKey(key, "/authors/"),
    name,
    openLibraryUrl: toOpenLibraryUrl(key),
  };
}

function normalizeWorkReference(work) {
  const key = work?.key || work?.work?.key || work || null;
  return {
    key,
    workId: normalizeKey(key, "/works/"),
    openLibraryUrl: toOpenLibraryUrl(key),
  };
}

function normalizeAuthorRecord(author) {
  const key = author?.key || null;

  return {
    authorId: normalizeKey(key, "/authors/"),
    key,
    name: resolveAuthorName(author),
    personalName: normalizeTextValue(author?.personal_name),
    title: normalizeTextValue(author?.title),
    bio: normalizeTextValue(author?.bio),
    birthDate: normalizeTextValue(author?.birth_date),
    deathDate: normalizeTextValue(author?.death_date),
    remoteIds: author?.remote_ids || {},
    alternateNames: ensureArray(author?.alternate_names),
    links: ensureArray(author?.links).map(normalizeLinkRecord).filter(Boolean),
    sourceRecords: ensureArray(author?.source_records),
    photos: buildAuthorPhotoSet(author?.photos),
    photoUrl: getAuthorPhotoUrl(ensureArray(author?.photos)[0]),
    openLibraryUrl: toOpenLibraryUrl(key),
    created: normalizeTimestamp(author?.created),
    lastModified: normalizeTimestamp(author?.last_modified),
    revision: author?.revision || null,
    latestRevision: author?.latest_revision || null,
  };
}

function normalizeWorkRecord(work) {
  const key = work?.key || null;
  const authors = ensureArray(work?.authors).map(normalizeAuthorReference);
  const covers = buildCoverSet(work?.covers);

  return {
    workId: normalizeKey(key, "/works/"),
    key,
    title: work?.title || "Untitled",
    subtitle: normalizeTextValue(work?.subtitle),
    description: normalizeTextValue(work?.description),
    subjects: ensureArray(work?.subjects),
    subjectPlaces: ensureArray(work?.subject_places),
    subjectTimes: ensureArray(work?.subject_times),
    subjectPeople: ensureArray(work?.subject_people),
    links: ensureArray(work?.links).map(normalizeLinkRecord).filter(Boolean),
    excerpts: ensureArray(work?.excerpts),
    authors,
    covers,
    coverUrl: covers[0]?.medium || null,
    firstPublishDate: normalizeTextValue(work?.first_publish_date),
    openLibraryUrl: toOpenLibraryUrl(key),
    created: normalizeTimestamp(work?.created),
    lastModified: normalizeTimestamp(work?.last_modified),
    revision: work?.revision || null,
    latestRevision: work?.latest_revision || null,
  };
}

function normalizeEditionRecord(edition) {
  const key = edition?.key || null;
  const isbn10 = ensureArray(edition?.isbn_10);
  const isbn13 = ensureArray(edition?.isbn_13);
  const covers = buildCoverSet(edition?.covers);
  const identifiers = {
    ...(edition?.identifiers || {}),
    ...extractIdFields(edition),
  };

  return {
    olid: normalizeKey(key, "/books/"),
    key,
    title: edition?.title || "Untitled",
    subtitle: normalizeTextValue(edition?.subtitle),
    fullTitle: normalizeTextValue(edition?.full_title),
    byStatement: normalizeTextValue(edition?.by_statement),
    publishDate: normalizeTextValue(edition?.publish_date),
    publishers: ensureArray(edition?.publishers),
    publishPlaces: ensureArray(edition?.publish_places).map((place) =>
      normalizeTextValue(place)
    ),
    publishCountry: normalizeTextValue(edition?.publish_country),
    numberOfPages: edition?.number_of_pages || null,
    pagination: normalizeTextValue(edition?.pagination),
    physicalFormat: normalizeTextValue(edition?.physical_format),
    physicalDimensions: normalizeTextValue(edition?.physical_dimensions),
    weight: normalizeTextValue(edition?.weight),
    languages: ensureArray(edition?.languages).map(normalizeLanguage).filter(Boolean),
    isbn10,
    isbn13,
    identifiers,
    covers,
    coverUrl:
      covers[0]?.medium ||
      getCoverByISBN(isbn13[0] || isbn10[0], "M") ||
      null,
    description: normalizeTextValue(edition?.description),
    notes: normalizeTextValue(edition?.notes),
    tableOfContents: ensureArray(edition?.table_of_contents),
    subjects: ensureArray(edition?.subjects),
    subjectPlaces: ensureArray(edition?.subject_places),
    subjectTimes: ensureArray(edition?.subject_times),
    subjectPeople: ensureArray(edition?.subject_people),
    deweyDecimalClass: ensureArray(edition?.dewey_decimal_class),
    lcClassifications: ensureArray(edition?.lc_classifications),
    genres: ensureArray(edition?.genres),
    contributions: ensureArray(edition?.contributions),
    series: ensureArray(edition?.series),
    links: ensureArray(edition?.links).map(normalizeLinkRecord).filter(Boolean),
    sourceRecords: ensureArray(edition?.source_records),
    authors: ensureArray(edition?.authors).map(normalizeAuthorReference),
    works: ensureArray(edition?.works).map(normalizeWorkReference),
    localId: edition?.local_id || null,
    openLibraryUrl: toOpenLibraryUrl(key),
    created: normalizeTimestamp(edition?.created),
    lastModified: normalizeTimestamp(edition?.last_modified),
    revision: edition?.revision || null,
    latestRevision: edition?.latest_revision || null,
  };
}

function normalizeSearchDoc(doc) {
  const cover = buildCoverVariants(doc?.cover_i);

  return {
    workId: normalizeKey(doc?.key, "/works/"),
    key: doc?.key || null,
    title: doc?.title || "Untitled",
    subtitle: normalizeTextValue(doc?.subtitle),
    alternativeTitles: ensureArray(doc?.alternative_title),
    authors: ensureArray(doc?.author_name),
    authorKeys: ensureArray(doc?.author_key),
    authorAlternativeNames: ensureArray(doc?.author_alternative_name),
    firstPublishedYear: doc?.first_publish_year || null,
    publishYears: ensureArray(doc?.publish_year),
    coverEditionKey: doc?.cover_edition_key || null,
    coverId: doc?.cover_i || null,
    coverUrls: cover,
    coverUrl: cover?.medium || null,
    editionCount: doc?.edition_count || 0,
    ebookAccess: doc?.ebook_access || null,
    hasFulltext: Boolean(doc?.has_fulltext),
    publicScan: Boolean(doc?.public_scan_b ?? doc?.public_scan),
    ia: ensureArray(doc?.ia),
    iaCollection: ensureArray(doc?.ia_collection),
    lendingEdition: doc?.lending_edition_s || doc?.lending_edition || null,
    lendingIdentifier:
      doc?.lending_identifier_s || doc?.lending_identifier || null,
    languages: ensureArray(doc?.language).map(normalizeLanguage).filter(Boolean),
    subjects: ensureArray(doc?.subject),
    subjectPlaces: ensureArray(doc?.place),
    subjectTimes: ensureArray(doc?.time),
    subjectPeople: ensureArray(doc?.person),
    publishers: ensureArray(doc?.publisher),
    contributor: ensureArray(doc?.contributor),
    identifiers: extractIdFields(doc),
    availability: doc?.availability || null,
    providers: ensureArray(doc?.providers),
    ratingsAverage: doc?.ratings_average || null,
    ratingsCount: doc?.ratings_count || null,
    readingLogCounts: {
      wantToRead: doc?.want_to_read_count || null,
      currentlyReading: doc?.currently_reading_count || null,
      alreadyRead: doc?.already_read_count || null,
    },
    openLibraryUrl: toOpenLibraryUrl(doc?.key),
    raw: doc,
  };
}

function normalizeSubjectWork(work) {
  const cover = buildCoverVariants(work?.cover_id);

  return {
    workId: normalizeKey(work?.key, "/works/"),
    key: work?.key || null,
    title: work?.title || "Untitled",
    editionCount: work?.edition_count || 0,
    firstPublishYear: work?.first_publish_year || null,
    coverId: work?.cover_id || null,
    coverEditionKey: work?.cover_edition_key || null,
    coverUrls: cover,
    coverUrl: cover?.medium || null,
    authors: ensureArray(work?.authors).map((author) => ({
      key: author?.key || null,
      name: resolveAuthorName(author),
      openLibraryUrl: toOpenLibraryUrl(author?.key),
    })),
    subjects: ensureArray(work?.subject),
    ia: ensureArray(work?.ia),
    iaCollection: ensureArray(work?.ia_collection),
    hasFulltext: Boolean(work?.has_fulltext),
    publicScan: Boolean(work?.public_scan),
    availability: work?.availability || null,
    openLibraryUrl: toOpenLibraryUrl(work?.key),
    raw: work,
  };
}

async function fetchJSON(url) {
  const res = await fetchFn(url, { headers: DEFAULT_HEADERS });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  return res.json();
}

async function fetchOptionalJSON(url) {
  const res = await fetchFn(url, { headers: DEFAULT_HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.json();
}

async function fetchPaginatedEntries(pathOrUrl, {
  entryKey = "entries",
  limit = null,
  pageSize = 100,
} = {}) {
  let nextUrl = new URL(toOpenLibraryUrl(pathOrUrl));
  if (!nextUrl.searchParams.has("limit")) {
    nextUrl.searchParams.set("limit", String(pageSize));
  }

  const entries = [];
  let pagesFetched = 0;
  let totalSize = null;

  while (nextUrl) {
    const data = await fetchJSON(nextUrl.toString());
    pagesFetched += 1;
    if (typeof data.size === "number") totalSize = data.size;

    entries.push(...ensureArray(data?.[entryKey]));

    if (limit != null && entries.length >= limit) {
      return {
        entries: entries.slice(0, limit),
        size: totalSize ?? entries.length,
        pagesFetched,
      };
    }

    if (!data?.links?.next) {
      return {
        entries,
        size: totalSize ?? entries.length,
        pagesFetched,
      };
    }

    nextUrl = new URL(data.links.next, BASE);

    if (limit != null) {
      const remaining = limit - entries.length;
      if (remaining <= 0) {
        return {
          entries,
          size: totalSize ?? entries.length,
          pagesFetched,
        };
      }
      nextUrl.searchParams.set("limit", String(Math.min(pageSize, remaining)));
    }
  }

  return {
    entries,
    size: totalSize ?? entries.length,
    pagesFetched,
  };
}

async function resolveAuthors(authorKeys) {
  const uniqueKeys = [...new Set(ensureArray(authorKeys).filter(Boolean))];
  const rawAuthors = await Promise.all(
    uniqueKeys.map((key) => fetchOptionalJSON(toOpenLibraryUrl(`${key}.json`)))
  );

  return rawAuthors.filter(Boolean).map((author) => ({
    ...normalizeAuthorRecord(author),
    raw: author,
  }));
}

async function resolveWorks(workKeys) {
  const uniqueKeys = [...new Set(ensureArray(workKeys).filter(Boolean))];
  const rawWorks = await Promise.all(
    uniqueKeys.map((key) => fetchOptionalJSON(toOpenLibraryUrl(`${key}.json`)))
  );

  return rawWorks.filter(Boolean).map((work) => ({
    ...normalizeWorkRecord(work),
    raw: work,
  }));
}

async function searchBooksResponse(
  query,
  { limit = 10, page = 1, language, sort, fields = "*" } = {}
) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    page: String(page),
    fields: Array.isArray(fields) ? fields.join(",") : String(fields),
  });

  if (language) params.set("language", language);
  if (sort) params.set("sort", sort);

  const data = await fetchJSON(`${BASE}/search.json?${params}`);

  return {
    numFound: data.numFound,
    start: data.start,
    numFoundExact: data.numFoundExact,
    numFoundLegacy: data.num_found,
    documentationUrl: data.documentation_url,
    query: data.q,
    offset: data.offset,
    docs: ensureArray(data.docs).map(normalizeSearchDoc),
    raw: data,
  };
}

async function searchBooks(query, options = {}) {
  const response = await searchBooksResponse(query, options);
  return response.docs;
}

async function getWorkRatings(workId) {
  const cleanId = normalizeKey(workId, "/works/");
  return fetchOptionalJSON(`${BASE}/works/${cleanId}/ratings.json`);
}

async function getWorkBookshelves(workId) {
  const cleanId = normalizeKey(workId, "/works/");
  return fetchOptionalJSON(`${BASE}/works/${cleanId}/bookshelves.json`);
}

async function getBookDetails(olid, { includeAuthors = true, includeWorks = true } = {}) {
  const cleanId = normalizeKey(olid, "/books/");
  const edition = await fetchJSON(`${BASE}/books/${cleanId}.json`);
  const normalizedEdition = normalizeEditionRecord(edition);
  const workKeys = normalizedEdition.works.map((work) => work.key).filter(Boolean);
  const authorKeys = normalizedEdition.authors.map((author) => author.key).filter(Boolean);

  const [authorDetails, workDetails, workRatings, workBookshelves] = await Promise.all([
    includeAuthors ? resolveAuthors(authorKeys) : Promise.resolve([]),
    includeWorks ? resolveWorks(workKeys) : Promise.resolve([]),
    includeWorks
      ? Promise.all(
          workKeys.map(async (key) => [key, await getWorkRatings(key)])
        )
      : Promise.resolve([]),
    includeWorks
      ? Promise.all(
          workKeys.map(async (key) => [key, await getWorkBookshelves(key)])
        )
      : Promise.resolve([]),
  ]);

  const ratingsByWork = Object.fromEntries(workRatings);
  const bookshelvesByWork = Object.fromEntries(workBookshelves);
  const firstWork = workDetails[0] || null;

  return {
    olid: cleanId,
    title: normalizedEdition.title,
    subtitle: normalizedEdition.subtitle,
    authors:
      authorDetails.length > 0
        ? authorDetails.map((author) => author.name)
        : normalizedEdition.authors.map((author) => author.name).filter(Boolean),
    publishDate: normalizedEdition.publishDate,
    publishers: normalizedEdition.publishers,
    numberOfPages: normalizedEdition.numberOfPages,
    isbn10: normalizedEdition.isbn10,
    isbn13: normalizedEdition.isbn13,
    subjects: normalizedEdition.subjects,
    description:
      normalizedEdition.description ||
      firstWork?.description ||
      null,
    coverUrl: normalizedEdition.coverUrl,
    coverUrls: normalizedEdition.covers,
    openLibraryUrl: normalizedEdition.openLibraryUrl,
    workId: normalizedEdition.works[0]?.key || null,
    edition: normalizedEdition,
    authorDetails,
    works: workDetails.map((work) => ({
      ...work,
      ratings: ratingsByWork[work.key] || null,
      bookshelves: bookshelvesByWork[work.key] || null,
    })),
    raw: {
      edition,
      authors: authorDetails.map((author) => author.raw),
      works: workDetails.map((work) => work.raw),
      ratingsByWork,
      bookshelvesByWork,
    },
  };
}

async function getWorkDetails(
  workId,
  { editionsLimit = null, pageSize = 100, includeRatings = true, includeBookshelves = true } = {}
) {
  const cleanId = normalizeKey(workId, "/works/");
  const [work, editionsResult, ratings, bookshelves] = await Promise.all([
    fetchJSON(`${BASE}/works/${cleanId}.json`),
    fetchPaginatedEntries(`${BASE}/works/${cleanId}/editions.json`, {
      entryKey: "entries",
      limit: editionsLimit,
      pageSize,
    }),
    includeRatings ? getWorkRatings(cleanId) : Promise.resolve(null),
    includeBookshelves ? getWorkBookshelves(cleanId) : Promise.resolve(null),
  ]);

  const normalizedWork = normalizeWorkRecord(work);
  const authorKeys = normalizedWork.authors.map((author) => author.key).filter(Boolean);
  const authorDetails = await resolveAuthors(authorKeys);
  const editions = editionsResult.entries.map(normalizeEditionRecord);

  return {
    workId: cleanId,
    title: normalizedWork.title,
    description: normalizedWork.description,
    subjects: normalizedWork.subjects,
    subjectPlaces: normalizedWork.subjectPlaces,
    subjectTimes: normalizedWork.subjectTimes,
    subjectPeople: normalizedWork.subjectPeople,
    authors:
      authorDetails.length > 0
        ? authorDetails.map((author) => author.name)
        : normalizedWork.authors.map((author) => author.name).filter(Boolean),
    coverUrl: normalizedWork.coverUrl,
    openLibraryUrl: normalizedWork.openLibraryUrl,
    firstPublishDate: normalizedWork.firstPublishDate,
    links: normalizedWork.links,
    excerpts: normalizedWork.excerpts,
    covers: normalizedWork.covers,
    ratings,
    bookshelves,
    editionCount: editionsResult.size,
    editionsFetched: editions.length,
    pagesFetched: editionsResult.pagesFetched,
    editions,
    authorDetails,
    raw: {
      work,
      ratings,
      bookshelves,
      editions: editionsResult.entries,
      authors: authorDetails.map((author) => author.raw),
    },
  };
}

async function getAuthorDetails(
  authorId,
  { worksLimit = null, pageSize = 100 } = {}
) {
  const cleanId = normalizeKey(authorId, "/authors/");
  const [author, worksResult] = await Promise.all([
    fetchJSON(`${BASE}/authors/${cleanId}.json`),
    fetchPaginatedEntries(`${BASE}/authors/${cleanId}/works.json`, {
      entryKey: "entries",
      limit: worksLimit,
      pageSize,
    }),
  ]);

  const normalizedAuthor = normalizeAuthorRecord(author);
  const works = worksResult.entries.map((work) => ({
    ...normalizeWorkRecord(work),
    raw: work,
  }));

  return {
    authorId: cleanId,
    name: normalizedAuthor.name,
    bio: normalizedAuthor.bio,
    birthDate: normalizedAuthor.birthDate,
    deathDate: normalizedAuthor.deathDate,
    photoUrl: normalizedAuthor.photoUrl,
    openLibraryUrl: normalizedAuthor.openLibraryUrl,
    title: normalizedAuthor.title,
    remoteIds: normalizedAuthor.remoteIds,
    alternateNames: normalizedAuthor.alternateNames,
    links: normalizedAuthor.links,
    sourceRecords: normalizedAuthor.sourceRecords,
    photos: normalizedAuthor.photos,
    workCount: worksResult.size,
    worksFetched: works.length,
    pagesFetched: worksResult.pagesFetched,
    works,
    raw: {
      author,
      works: worksResult.entries,
    },
  };
}

async function getBooksBySubject(subject, { limit = 20, offset = 0 } = {}) {
  const slug = subject.toLowerCase().replace(/\s+/g, "_");
  const data = await fetchJSON(
    `${BASE}/subjects/${encodeURIComponent(slug)}.json?limit=${limit}&offset=${offset}`
  );

  return ensureArray(data.works).map(normalizeSubjectWork);
}

async function getSimilarBooks(workId, limit = 12) {
  const work = await getWorkDetails(workId, {
    editionsLimit: 0,
    includeRatings: false,
    includeBookshelves: false,
  });

  if (!work.subjects || work.subjects.length === 0) {
    return searchBooks(work.title, { limit });
  }

  const subject = work.subjects[0];
  const books = await getBooksBySubject(subject, { limit: limit + 1 });

  return books
    .filter((book) => book.workId !== work.workId && book.key !== `/works/${work.workId}`)
    .slice(0, limit);
}

async function getTrendingBooks(period = "weekly", limit = 10) {
  const data = await fetchJSON(`${BASE}/trending/${period}.json?limit=${limit}`);

  return ensureArray(data.works).map((work) => ({
    ...normalizeSearchDoc(work),
    editionsPreview: work.editions || null,
    raw: work,
  }));
}

async function getBookByISBN(isbn, options = {}) {
  const data = await fetchJSON(`${BASE}/isbn/${isbn}.json`);
  const olid = normalizeKey(data.key, "/books/");
  return getBookDetails(olid, options);
}

async function demo() {
  console.log("Open Library Scraper Demo\n");

  const query = "Dune";
  const search = await searchBooksResponse(query, { limit: 3 });
  console.log(`Search "${query}" returned ${search.numFound} matches total.`);

  if (search.docs.length > 0) {
    const first = search.docs[0];
    console.log(`Top hit: ${first.title} (${first.firstPublishedYear || "?"})`);

    const work = await getWorkDetails(first.workId, { editionsLimit: 25 });
    console.log(
      `Work "${work.title}" fetched ${work.editionsFetched}/${work.editionCount} editions.`
    );

    const editionKey =
      work.editions.find((edition) => edition.olid)?.olid || first.coverEditionKey;

    if (editionKey) {
      const edition = await getBookDetails(editionKey, { includeWorks: true });
      console.log(`Edition "${edition.title}" has ${edition.authors.length} author(s).`);
    }
  }
}

if (require.main === module) {
  demo().catch(console.error);
}

module.exports = {
  searchBooks,
  searchBooksResponse,
  getBookDetails,
  getWorkDetails,
  getAuthorDetails,
  getSimilarBooks,
  getBooksBySubject,
  getTrendingBooks,
  getBookByISBN,
  getWorkRatings,
  getWorkBookshelves,
  getCoverUrl,
  getCoverByISBN,
};
